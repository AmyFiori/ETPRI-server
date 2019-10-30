module.exports = class sessions {
  constructor (configDB, config) {
      // used for admin to see the current state of the server in real time, all data is sent client side to be viewed
      // static
      this.serverStart  = Date.now();
      this.config       = config;
      this.configDB     = configDB

      // requests
      this.openRequests = {};  // Requests that are still processing
      this.lastRequest  =  Date.now();   // see how hard server is being hit
      this.sessionKey   = 0;   // increment each time a new session is started

      // open sessions
      this.sessions     = {};  // open sessions


      // set timer to run cleanUp every second
      setInterval(function() {
        this.cleanUp();
      }.bind(this), 1000);
    }

  // public
  /*

  class keeps track of user sessions, requests and response authentication

  ------------------------------ API
  public

  responseAddProxy( response, proxyObj ) - add to log  detail of proxy requests

  private
  initSession(sessionKey)                    - private, init Session attributes
  initRequest(sessionKey, request, response) - private, intit Request object
  parseCookies(request)                      - put cookies in an object so that they can be accessed easy

  review
  authorizedSubApp(subApp, request, response) {   // ?? used to login from html page
  cleanUp()                                  - implemnet in future, setup to run on timer

  -------------- future - not implement yet
  server logs  // used for none real time analysis

    // not implemented yet
    requestsIn - all requests coming in get logged here
    response200Not - if a request has not
    console.log    - pm2 writes this to a log
    number of requestsIN and the sum of esponse200Not and response200 should be equal

    // implement in the future
    proxyRequestIn      -
    proxyResponse200    -
    prosyResponse200Not -
  */

  getSessionData(obj, request,response){// public, return sessions object
    this.responseEnd(response, JSON.stringify(this));
  }

  log(request, response) { // public, called from server.js when server request first comes in

    console.log(`Started: Method: ${request.method}, url: ${request.url}`);

    // requests start here
    let sessionKey;
    // get cookie
    const cookie = this.parseCookies(request);

    // If the cookie has a serverStart attribute that matches the current server instance,
    // and it has a valid session key (one that's a key in this.sessions),
    // then go straight to initRequest. If any of that ISN'T true, start a new session first.
    if (!(cookie.serverStart && cookie.serverStart == this.serverStart
          && cookie.sessionKey && this.sessions[cookie.sessionKey])) {
            sessionKey = this.sessionKey++;
            this.initSession(sessionKey);
            response.setHeader('Set-Cookie', [`serverStart=${this.serverStart};path="/"`, `sessionKey=${sessionKey};path="/"`]);
            console.log(`Setting cookie with session key ${sessionKey}`);
    }
    else {
      sessionKey = cookie.sessionKey;
    }

    this.initRequest(sessionKey, request, response);

    response.setHeader('Access-Control-Allow-Origin', '*');       // what does this do?
  }

  responseEnd(response, content) {  // public, called to end response back to client
    // make request complete not written yet (This needs punctuating, but I don't understand it well enough to try.)
    response.end(content);  // tell the client there is no more coming
    delete this.openRequests[response.harmonyRequest];  // remove from openRequest object
    const keys = response.harmonyRequest.split("-"); // key[0] is sessionKey  key[1] is reqestKey
    const obj = this.sessions[keys[0]].requests[keys[1]];
    obj.duration = Date.now() - obj.start;

    console.log(`Finished: ${JSON.stringify(this.sessions[keys[0]].requests[keys[1]])}`);
  }

  login(userObj, request, response) { // public, used to login from html page
    var response2client={}; // I think this should be an object so the attributes can have meaningful names instead of numbers
    response2client.serverLocation = app.config.couchDB.slice(7); // couchDB's value will be "couchDBlocal" or "couchDBremote" - remove the "couchDB" to get the location
    response2client.webserver = app.config.webserver;

    const origin = request.headers.origin; // ex. https://local.etpri.org:8443
    const hostName = request.headers.host.split(":")[0]; // ex. local.etpri.org,
    const referer = request.headers.referer; // ex. https://local.etpri.org:8443/harmony/, , https://dev.etpri.org/?page='home', or https://etpri.org/harmonyBeta

    // hopefully there will never be subapps of subapps - if so, have to ask UD how they're formatted
    const refererPath = referer.replace(origin, ""); // ex. /harmony/
    const refererArray = refererPath.split("/"); // ex. ["", "harmony", ""]
    let subapp = refererArray[1];  // ex. harmony
    const subapps = app.config.hosts[hostName].subApps;
    if (subapp in subapps) {
      const filePath = subapps[subapp].filePath;
      const pathArray = filePath.split("/");
      response2client.version = pathArray[pathArray.length - 2] +"("+ pathArray[pathArray.length - 1] + ")"; // last entry - for instance, if the path were etpri/harmony/0.9.5, the version would be harmony(0.9.5).
      response2client.subapp = subapp;
    }
    else subapp = "default"; // Any URL that doesn't reference a valid subapp should refer to the default page

    const sessionKey = this.checkCookies(request, response);

    if (sessionKey) { // If we've gotten this far, there IS a valid session
      const token =request.headers.authorization;
      var username="",password="";

      // get username and password from header
      if (token) {
        const auth=Buffer.from(token.split(" ")[1], 'base64').toString()
        const parts=auth.split(/:/);                 // split on colon
        username=parts[0];
        password=parts[1];
        response2client.username = username;
      }

      let results = {};

      this.lookForUser(username, password) // Step 1: Find the user doc. Everything else depends on that.
      .then(function(userDoc) { // Step 2: Get the user's people doc and their permissions (and the resources the permissions attach to)
        let userGUID = null;
        if (!userDoc || !userDoc.docs) return Promise.reject("Bad response from database")
        else if (userDoc.docs.length === 0) return Promise.reject("No user")
        else if (userDoc.docs.length > 1) return Promise.reject("Multiple users")
        else { // If a SINGLE user was found with the given name and password, login is possible (not yet guaranteed)
          const user = userDoc.docs[0];
          const userGUID = user._id;
          response2client.userGUID = user._id;

          results.user = user;
          const promises = [];
          promises.push(
            this.lookForGUID(this.configDB.mainDB, app.removeDBSuffix(user.data.k_personID)) // Find the people doc associated with the user...
            .then(function(peopleDoc) {
              results.people = peopleDoc.docs[0];
            }) // and store it when we find it
          );
          promises.push(
            this.lookForPermissions(this.configDB.mainDB, userGUID) // At the same time, find the permissions docs for the user...
            .then(function(permDocs) {
              results.permissions = permDocs.docs; // store them...
              return this.lookForResources(this.configDB.mainDB, permDocs.docs) // and then use them to find the resources the user can access...
              .then(function(resourceDocs) {
                results.resources = resourceDocs.docs;
                results.permissions = this.filterRelations(results.permissions, results.resources, "to");
              }.bind(this)); // and store THEM.
            }.bind(this))
          );
          return Promise.all(promises);
        }
      }.bind(this))
      .then(function() { // Step 3: Determine whether the user has permission to log in, and if so, send back their information
        const thisResource = results.resources.filter(x => x.data.l_URL === origin && x.data.s_subApp === subapp);
        if (thisResource.length === 0) {
          return Promise.reject("No permission");
        }
        else if (thisResource.length > 1) {
          return Promise.reject("More than one permission");
        }
        else { // If the user exists (already confirmed) and has exactly ONE permissions doc linking them to this resource, they can log in
          const thisPermission = results.permissions.find(x => app.removeDBSuffix(x.data.k_toID) === thisResource[0]._id);
          const DB = thisPermission.data.s_defaultDB;
          const DBs = Object.keys(thisPermission.data.o_allowedDBs);

          this.sessions[sessionKey].permissions = results.permissions;
          this.sessions[sessionKey].resources = results.resources;
          response2client.DB = DB;
          response2client.DBs = DBs;
          response2client.permissions = results.permissions;

          // If a user and database were specified when logging in, and that user is the one who has logged in, send them to that database
          if (userObj.currentGUID === results.people._id && userObj.currentDB) {
            this.sessions[sessionKey].DB = userObj.currentDB; // Current DB
            response2client.DB = userObj.currentDB; // Send this info back to the client as well as storing it in session
          }

          response2client.resources = results.resources.map( resource => ({ // Fill this in attribute by attribute, leaving out a_databases and o_actions, because the client doesn't need to know what permissions are possible.
            "_id": resource._id,
            "data": {
              "s_name": resource.data.s_name,
              "l_URL": resource.data.l_URL,
              "s_subApp": resource.data.s_subApp
            }
          }));

          if (sessionKey) {
            this.sessions[sessionKey].resources = results.resources;
          }

          response2client.peopleDoc = results.people;

          this.responseEnd(response, JSON.stringify(response2client) );
        }
      }.bind(this))
      .catch( function(err) {
        console.log(err);
        this.responseEnd(response, err); // This is what sends the error message to the client.
      }.bind(this));
    }
  }

  initSession(sessionKey) {  // private, init Session object
    this.sessions[sessionKey]={};
    const s = this.sessions[sessionKey];

    s.userName    = "";  // userName if this is a logged in session
    s.permissions = [];  // permission this session has - array of objects each representing permissions for one resource
    s.DB          = "";  // Name of the user's current database
    s.DBs         = [];  // List of all databases the user can access
    s.requests    = [];  // requests made from this session
  }

  initRequest(sessionKey, request, response) { // private, intit Request object
    const now = Date.now();

    const obj = {             // request object to store
      start:    now,
      lastRequest: now - this.lastRequest,
      duration: 0,                               // will be replaced with milliseconds it took to process
      ip:      request.connection.remoteAddress, // ip address that request came from
      method:  request.method,                   // post, get, ...
      url:     request.url
    }

    this.lastRequest = now; // update to now, so we log time between now and next request
    const nextRequestKey = this.sessions[sessionKey].requests.length;
    const key = sessionKey +"-"+ nextRequestKey;
    this.openRequests[key]   = 0;                     // store request that is in process and that it just started procesing
    response.harmonyRequest = key;                    // store in response way to delete openRequest when it is done
    this.sessions[sessionKey].requests[nextRequestKey] = obj;  // store request in session
  }

  responseAddProxy(response, proxObj) { // I have no idea what the hell this does or why. If you want me to document my code, how about document your own?
    const keys = response.harmonyRequest.split('-');
    this.sessions[keys[0]].requests[keys[1]].proxy = proxObj;
  }

  cleanUp() {   // private - implement in future
    // see if any pending reqests need to be culled AMF - What does this mean?

    // see if any sessions need to be culled
    for (let sess in this.sessions) { // Go through all existing sessions
      const session = this.sessions[sess];
      const requests = session.requests; // Get the list of requests
      const now = Date.now();
      // If the LAST request is older than maxSessionAge, delete the session. Note: maxSessionAge is in minutes; must convert to ms
      let sessionAge = now - requests[requests.length -1].start;
      if (sessionAge > app.config.maxSessionAge.totalMilliSec) {
        // Remove any open requests associated with this session.
        for (let req in session.requests) {
          const key = sess +"-"+ req;
          delete this.openRequests[key]; // will delete the open request with this key if it exists, and will not fail if the request doesn't exist
        }
        delete this.sessions[sess];
      }
    }
  }

  parseCookies (request) { // private, put cookies in an object so that they can be accessed easily
    // https://stackoverflow.com/questions/3393854/get-and-set-a-single-cookie-with-node-js-http-server
    const list = {};
    let rc = null;

    if (request.headers) {
      rc = request.headers.cookie;
    }

    if (rc && rc.split(';').length > 2) {
      console.log("Problem");
    }

    rc && rc.split(';').forEach(function( cookie ) {
        var parts = cookie.split('='); // Split the cookie at "=", so the first entry is the attribute name and the rest is the value
        // Remove the attribute name, trim off whitespace, and that's the key.
        //Join the rest of the array with "=" just in case it was split earlier (in case there was a = in the value),
        // decode it and that's the value.
        list[parts.shift().trim()] = decodeURI(parts.join('='));
    });

    return list;
  }

  parseSetCookies(response) {
    const list = {};
    let rc = null;

    if (response._headers) {
      rc = response._headers['set-cookie'];
    }

    rc && rc.forEach(function( cookie ) {
        var parts = cookie.split('='); // Split the cookie at "=", so the first entry is the attribute name and the rest is the value
        // Remove the attribute name, trim off whitespace, and that's the key.
        const key = parts.shift().trim();
        // Join the rest of the array with "=" just in case it was split earlier (in case there was a = in the value),
        // cut it off at the first semicolon so that we don't get the path or other attributes as well, and decode it
        const value = decodeURI(parts.join('=').split(";")[0]);
        list[key] = value;
    });

    return list;
  }

  authorizedSubApp(subApp, request, response) {   // ?? used to login from html page
    // get from database, for now hard code protection of harmony
    if (! subApp == "harmony") {
      return true;  // no authorization needed
    }

    const token  = request.headers.authorization;
    var username = "", password = "";

    // get username and password from header
    if (token) {
      const auth=Buffer.from(token.split(" ")[1], 'base64').toString()
      const parts=auth.split(/:/);                 // split on colon
      username=parts[0];
      password=parts[1];
    }

   if (username!=="amy") {
     response.writeHead(401);
     response.end("not authorized");
     return false;
   } else {
     return true;
   }
  }

  checkCookies(request, response) {
    let sessionKey = null;

    let cookie = this.parseCookies(request); // If a session was already running, gets its cookie
    if (response._headers && response._headers['set-cookie']) { // If a session is being created for this request, gets its cookie
      cookie = app.sessions.parseSetCookies(response);
    }

    // If there is a valid cookie linked to a session running on this server
    if (cookie && cookie.serverStart && cookie.serverStart == this.serverStart && cookie.sessionKey && this.sessions[cookie.sessionKey]) {
      sessionKey = cookie.sessionKey;
    }
    else { // If there is no valid session, can't go any farther - just report the error
      console.log("Error: No valid session running, could not log in");
      this.responseEnd(response, "No session"); // Send the phrase "No session" back to the client
    }

    return sessionKey;
  }

  lookForUser(name, password) {
    const obj = {
    "path": `/${this.configDB.mainDB}/_find`, // Should ALWAYS search for login info in the main DB
    "method": "post"}

    // need to find user with given username
    const data = {
    "selector": {
      "meta.s_type":     {"$eq":"user"},
      "data.s_username": {"$eq":name},
      "data.s_password":  {"$eq":password},
      "$or": [
        {"meta.d_deleted":0},
        {"meta.d_deleted":{"$exists":false}}
      ]
    },
    "limit":2}; // A limit of 2 will let us see whether there's more than 1 or not -- beyond that, we don't care how many there are

    return app.couchDB.request(obj, JSON.stringify(data));
  }

  lookForPermissions(db, userGUID) {
    const obj = {"path": `/${db}/_find`, "method": "post"};
    return app.couchDB.request(obj,`{
      "selector": {
        "meta.s_type":     {"$eq":"permission"},
        "data.k_fromID": {"$in":["${userGUID}", "${app.addDBSuffix(userGUID, this.configDB.mainDB)}"]},
        "$or": [
          {"meta.d_deleted":0},
          {"meta.d_deleted":{"$exists":false}}
        ]
      },
      "limit":99}`
    );  // Go look for all of that user's permissions. Permission is a relation FROM a person TO a resource.
  }

  lookForResources(db, docs) {
    let resources = [];
    docs.forEach(doc => {
      resources.push(app.removeDBSuffix(doc.data.k_toID));
    });

    const selector = {
      "selector": {
        "_id": {"$in": resources},
        "$or": [
          {"meta.d_deleted":0},
          {"meta.d_deleted":{"$exists":false}}
        ]
      },
      "limit":99
    };

    const obj = {"path": `/${db}/_find`, "method": "post"};

    return app.couchDB.request(obj, JSON.stringify(selector));  // Go look for all of that user's permissions. Permission is a relation FROM a person TO a resource.
  }

  filterRelations(relations, nodes, direction) {
    const nodeIDs = nodes.map(x => x._id);
    return relations.filter(x => nodeIDs.includes(app.removeDBSuffix(x.data[`k_${direction}ID`])));
  }

  lookForGUID(db, GUID) {
    const obj = {"path": `/${db}/_find`, "method": "post"};
    return app.couchDB.request(obj, `{"selector": {"_id": {"$eq": "${GUID}"}}}`);
  }

  changeProfile(requestObj, request, response) {
    const data = requestObj.data;
    const sessionKey = this.checkCookies(request, response);

    if (sessionKey) { // If we've gotten this far, there IS a valid session
      this.lookForUser(data.oldHandle, data.oldPW)
      .then( function(userDoc) {
        if (!userDoc || !userDoc.docs) responseText = "Bad response from database";
        else if (userDoc.docs.length === 0) this.responseEnd(response, "No user");
        else if (userDoc.docs.length > 1) this.responseEnd(response, "Multiple users");
        else { // If a SINGLE user was found with the given name and password, we can continue
          const GUID = userDoc.docs[0]._id;
          const obj = {
            "path": `/${this.configDB.mainDB}/${GUID}`,
            "method": "put"
          };

          const sendData = JSON.parse(JSON.stringify(userDoc.docs[0]));
          delete sendData._id;

          if (data.newHandle) {
            sendData.data.s_username = data.newHandle;
          }
          if (data.newPW) {
            sendData.data.s_password = data.newPW;
          }

          app.couchDB.request(obj, JSON.stringify(sendData))
          .then(function(result) {
            if (result.ok === true) {
              this.responseEnd(response, "Success");
            }
            else {
              this.responseEnd(response, "Failure");
            }
          }.bind(this));
        } // end else
        this.responseEnd(response, responseText);
      }.bind(this)); // end function
    } // end if
    else this.responseEnd(response, "No session");
  }

  logout(obj, request, response) {
    response.setHeader('Set-Cookie', [`serverStart="";Max-Age=0;path="/"`, `sessionKey="";Max-Age=0;path="/"`]);
    console.log("Removing session key and server start headers");
    this.responseEnd(response, "Logged Out");
  }
} //////// end of class def
