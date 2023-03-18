// external
import * as rp from 'request-promise';

// types
import { AccessResponse, IntegrationDatapoints, SeedInput } from './types';

// The API key
export const MAILGUN_API_KEY = 'FILL IN FROM ACCOUNT';
export const MAILGUN_API_BASE_URL = 'https://api.mailgun.net:443/v3/lists/';


export const mailgunDataPoints: IntegrationDatapoints = {
  /**
   * Create mailing lists and Seed user(s) onto them
   */
  seed: async (seedInput: SeedInput): Promise<void> => {
    return await addUserToMailingList(MAILGUN_API_BASE_URL, seedInput.mailingList, seedInput.identifier)
    .then((response)=>{
      if(!response){
        console.log(`Adding ${seedInput.identifier} TO ${seedInput.mailingList} failed`);
      }
    });
  },

  /**
   * Get all mailing lists that the user belongs to
   */
  access: async (identifier: string): Promise<AccessResponse> => {
    //Note:: All errors are handled at the individual function level 
    //Errors would not propogate to the parent access function

    //STEP 1:: Fetch all Mailing Lists Present
    var mailingListData = await getAllMailingListAddress(MAILGUN_API_BASE_URL+`pages?limit=100`, []);

    //STEP 2:: Check if the identifier is a member of any Mailing List
    //However we could have also used GET:: /list/{address}/members and check for a identifier
    //but this approach would increase both space and time complexity
    var promises = new Array<Promise<string>>();
    mailingListData.forEach((address) => {
      promises.push(checkIfUserInMailingList(MAILGUN_API_BASE_URL, address ,identifier));
    });

    //STEP 3:: Return the Mailing list Addresses that user has subscribed for
    return await Promise.all(promises).then((response)=>{
      var subscribedMailingList = new Array<string>();
      response.forEach((res)=>{
        //checking if the string is not null or empty
        if(res){
          subscribedMailingList.push(res);
        }
      });
      var accessResponse: AccessResponse= {data: subscribedMailingList, contextDict: {mailingLists: subscribedMailingList}};
      return accessResponse;
    });

  },

  /**
   * Remove the user from all mailing lists.
   * NOTE: Erasure runs an Access (access()) before it to
   * fetch the context data it might need.
   */
  erasure: async (identifier: string, contextDict?: object): Promise<void> => {
    
    var promises = new Array<Promise<boolean>>();

    //Step 1:: Check for contextDictonary
    if(contextDict && contextDict["mailingLists"]){
      //if ContextDict is present
      //call deleteUserFromMailingList with all the address present in mailingList array
      contextDict["mailingLists"].forEach((mailingAddr) =>{
        promises.push(deleteUserFromMailingList(MAILGUN_API_BASE_URL, mailingAddr, identifier))
      });

      //Step 2: Await until all deleteUserFromMailingList calls are complete
      return await Promise.all(promises).then((response)=>{
        response.forEach((res)=>{
          if(!res){
            //Debugging purpose
            console.log("Delete might have not completed successfully");
          }
        });
      });
    }
    else{
      //Can call access again here
      //limiting to the use case where user does access and then erasure is done as a followup step
      console.log("ContextDict Not received");
    }
  },
};


//Implemented the following async Functions
//1) getAllMailingListAddress - Route::  GET :: https://api.mailgun.net:443/v3/lists/pages?limit=100
//2) checkIfUserInMailingList - Route::  GET :: https://api.mailgun.net:443/v3/lists/{address}/members/{identifier}
//3) deleteUserFromMailingList- Route::  DELETE :: https://api.mailgun.net:443/v3/lists/{address}/members/{identifier}
//4) addUserToMailingList - Route::  POST :: https://api.mailgun.net:443/v3/lists/{address}/members/{identifier}



/**
  * Returns all the Mailing List address peresent
  * By looping through all the available pages
  */
async function getAllMailingListAddress(url, data): Promise<[string]> {
  return rp.get(url)
  .then(async (response)=> {
      //Parse Data
      response = JSON.parse(response);

      //Update mailingListAddresses
      for(var item of response.items)
      {
        data.push(item.address)
      }

      //Check for Next Page
      //if next page exists recursively call the same function
      if(response.paging && response.paging.next){
        var nextUrl= MAILGUN_API_BASE_URL+`pages?`;
        const urlParams = new URLSearchParams(response.paging.next);
        urlParams.forEach((value, key) => {
          if(!key.includes("page")){
            nextUrl+=`${key}=${value}&`
          }
        });

        return await getAllMailingListAddress(nextUrl, data);
      }
      //else just return the data
      //Scenario:: on last page
      else{
        return data;
      }
      
  })
  .catch((err)=> {
    //for Debugging Purpose
    //Handles Errors if the next page mentioned in paging doesn't exist
    //OR if the URL is invalid
    //returns entries which were until before the error occured
    if((err?.statusCode && err?.statusCode !=404)
       || err.error.statusCode != 404){
      console.log("On getAllMailingListAddress Error Handle");
      console.log("ERROR:: "+ JSON.stringify(err));
    }
    return data;
  });

}

/**
  * Checks if a User is Present on a Mailing List
  * If Yes, it returns the mailing list address(string)
  * In other scenarios, it returns null which implies user is not present in the given mailing list
  */
async function checkIfUserInMailingList(url: string ,address : string, identifier :string): Promise<string> {
  url= `${url}${address}/members/${identifier}`;
  return rp.get(url)
  .then(async (response)=> {
      response = JSON.parse(response)
      // Checks if User is present and if he has subscribed to the mailing address
      if(response.member && response.member.address == identifier && response.member.subscribed){
        return address;
      }
  })
  .catch((err)=> {
    //for Debugging Purpose
    //If statusCode is 404 it implies users is not present on the mailing Address
    //for Other scenarios logging the error for debugging purpose
    if(err.statusCode != 404){
      console.log("On checkIfUserInMailingList Error Handle:: ERROR URL:: "+ url);
      console.log("ERROR:: "+ JSON.stringify(err));
    }
    return null;
  });

}


/**
  * Deletes User(based on identifier) from a given Mailing List
  * Returns true if the delete was successful and false otherwise
  * Can do hard checks on parent function using return value
  */
async function deleteUserFromMailingList(url: string, address : string, identifier :string): Promise<boolean> {
  url= `${url}${address}/members/${identifier}`;
  return rp.delete(url)
  .then(async (response)=> {
      response = JSON.parse(response);
      //console.log(response.message); //to check if the call is actually reaching here
      if(response.member && response.member.address == identifier){
        return true;
      }
  })
  .catch((err)=> {
    //for Debugging Purpose
    console.log("On deleteUserFromMailingList Error Handle:: ERROR URL:: "+ url);
    console.log("ERROR:: "+ JSON.stringify(err));
    return false;
  });
}




/**
  * Adds User(based on identifier) to a given Mailing List
  * Returns true if the POST call was successful and false otherwise
  * Can do hard checks on parent function using return value
  */
async function addUserToMailingList(url: string, address : string, identifier :string): Promise<boolean> {
  url= `${url}${address}/members?address=${identifier}&upsert=yes`;
  return rp.post(url)
  .then(async (response)=> {
      response = JSON.parse(response);
      //console.log(response.message); //to check if the call is actually reaching here
      // Checks if User is present and if he has subscribed to the mailing address
      if(response.member && response.member.address == identifier && response.member.subscribed){
        return true;
      }
  })
  .catch((err)=> {
    //for Debugging Purpose
    console.log("On addUserToMailingList Error Handle:: ERROR URL:: "+ url);
    console.log("ERROR:: "+ JSON.stringify(err));
    return false;
  });
}