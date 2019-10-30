/*

couchdbProxy - web server addes serverside information about couchDB servers and foward requests
to couchDB. then gives results back to client

message sent from client
obj.upstream   = name of configure file for a couchDB server contians below info
obj.method     = post, put, get, etc.
obj.database   = path to database, blank if message is to server
obj.message    = to dabase _all_docs, key ...
obj.data       = json data to send

----------- API
public
request(obj, response) { // public, proxy interface

private
sendHTTPS(obj, response) - private, use HTTPS secure transfer
sendHTTP(obj, response) { // not secure, for local server and test only
*/



module.exports = class couchdbProxy {

constructor(server) {
  this.http   = require('http');      // process http requests
  this.https  = require('https');     // process https requests
  this.uuidv1 = require('uuid/v1');   // Generate GUIDs
  this.server = server;               // comes from config/_config.json
}


/* low level interface to be called by web server
all attributes are strings
obj.upstream   = name of configure file for a couchDB server contains below info
obj.protocol   = http or https,  https is preferred
obj.ip         = ?.com
obj.port       = 443, 584 etc
obj.upKey      = user id for upstream couchDB server
obj.upPassword = password  upstream couchDB server

//
obj.database   = path to database, blank if message is to server
obj.message    = to dabase _all_docs, key ...
obj.data       = json data to send
*/

request(obj, req, response, DB) { // public, proxy interface
//  let x = obj.protocol +"://"+ obj.ip +":"+obj.port;
  let cookie = app.sessions.parseCookies(req);
  if (response.headers && response.headers['set-cookie']) {
    cookie = app.sessions.parseSetCookies(response);
  }

  const loggedIn = cookie && cookie.serverStart && cookie.serverStart == app.sessions.serverStart
                   && cookie.sessionKey && app.sessions.sessions[cookie.sessionKey]; // True if the user is logged in (has a cookie representing a valid session on this server)

  let hasPermission = false;
  if (DB && loggedIn) {
    const session = app.sessions.sessions[cookie.sessionKey];
    const permissions = session.permissions;
    const resources = session.resources;

    if (resources && permissions) { // assuming that a person with resources and permissions is logged in, we can see whether they have permission for this specific request
      // extract the host name and subapp to check permissions
      const origin = req.headers.origin; // ex. https://local.etpri.org:8443
      const hostName = req.headers.host.split(":")[0]; // ex. local.etpri.org
      const subapp = req.headers.referer // ex. "https://local.etpri.org:8443/harmony/"
        .replace(req.headers.origin, "") // ex. "/harmony/"
        .split("/") // ex. ["/", "harmony", "/"]
        [1]; // ex. harmony
      const subapps = app.config.hosts[hostName].subApps;
      if (!subapp in subapps) subapp = "default";

      const thisResource = session.resources.find(x => x.data.l_URL === origin && x.data.s_subApp === subapp);

      if (thisResource) { // assuming the user can access this resource at all...
        const resourceID = thisResource._id;
        const thisPermission = permissions.find(perm => app.removeDBSuffix(perm.data.k_toID) === resourceID); // get the permission doc for the resource

        hasPermission = thisPermission.data.o_allowedDBs.hasOwnProperty(DB); // see if the requested database is allowed
      }
    }
  }

  if (hasPermission) {
    // construct a URL to display to log to show
    if (obj.message) {
      this.server.path   = `/${DB}/${obj.message}`;
    }
    else {
      this.server.path = `/${DB}`;
    }

    this.server.method = obj.method;

    // NOTE: A couple of problems to watch out for here:
    // First, the check for the method is case sensitive and if we send a method of "Post", this code won't run.
    // Second, a find request also has a method of post, but is NOT creation and should NOT cause a GUID to be assigned
    // At the moment, these problems are cancelling each other out, as find seems to be the only request type which
    // writes "Post" instead of "post" for the method. That is probably not the ideal solution.
    if (obj.method == "post" && obj.data) { // If we are CREATING a document, and it has data (which it should)...
      const data = JSON.parse(obj.data); // Parse its data, and...
      if (!data._id) { // If it doesn't already have an ID...
        data._id = this.uuidv1(); // Give it a GUID...
        obj.data = JSON.stringify(data); // and replace the old data string
      }
    }

    app.sessions.responseAddProxy( response, {proxy: "couchDB", method: obj.method, path: this.server.path, data: obj.data} );

    if (       this.server.protocol == "https:")  { return this.requestHTTPS(obj.data, response);}
    else if (this.server.protocol == "http:" )    { return this.requestHTTP (obj.data, response);}
    else                                          { throw("error, looking for http or https, protocol =  " + this.server.protocol);}
  }
  else {
    response.setHeader('Set-Cookie', [`serverStart=""; Max-Age=0`, `sessionKey=""; Max-Age=0`]);
    console.log("Removing sessionKey and serverStart cookies");
    app.sessions.responseEnd(response, "Not Logged In"); // End the session right away
  }
}

// send to couchDB with HTTPS, the recommended way
requestHTTPS(data, response) {  // private, use HTTPS secure transfer
  // make request to server and wait for a response
  const req = this.https.request(this.server, (res) => {
    res.on('data', (d) => {
      response.write(d.toString());  // response from couchDB back to client
     // console.log(d.toString());
    });
    res.on('end', () => {
      app.sessions.responseEnd(response, "");  // let client know there is no more data
    })});

  req.on('error', (e) => {
      console.error(e);
    });
  req.end(data);  // sending request to couchDB server
}

requestHTTP(data, response) { // not secure, for local server and test only
  // make request to server and wait for a response
  const req = this.http.request(this.server, (resp) => {
    // stream data to client.
    resp.on('data', (d) => {
      response.write(d.toString());
//      console.log(d.toString());
    });
    resp.on('end', () => {
      app.sessions.responseEnd(response, "");  // let client know there is no more data
    });
  });

  req.on("error", (e) => {
    console.log("Error: " + e.message);
  });

  req.end(data);  // tell system request is finished
}

} ///////////// end class
