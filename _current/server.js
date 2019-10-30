/*

small web server that serves static files and is an:

  API into couchDB, json document store
  API into web, messages to reload config, give status, etc.

requestIn(request, response) is called for each request comming in

in order for the system to keep track of sessions and requests, it is important to call
  app.sessions.responseEnd();
and NOT
  response.end();

This is because app.sessions.reponseEnd keeps track of the time it took for a request to finish.

*/

module.exports = class server {

constructor () {
  // native nodejs modules
  this.https    = require('https');     // process https requests
  this.fs       = require('fs');        // access local file system
  this.path     = require('path');      // used once (maybe use string function insead)
  this.uuidv1   = require('uuid/v1');   // Generate GUIDs

  this.config = this.loadConfiguration();

  this.couchConfig = this.config[this.config.couchDB];

  // local classes
  this.couchDB        = new (require('./couchDB.js'             ))(this.couchConfig);
  this.couchdbProxy   = new (require('./couchdbProxy.js'        ))(this.couchConfig);
  this.couchdbNoLogin = new (require('./couchdbProxyNoLogin.js' ))(this.couchConfig, this.config);
  this.picServer      = new (require('./picServer.js'           ))(this.couchConfig, this.config);
  this.sessions       = new (require('./sessions.js'            ))(this.couchConfig, this.config);

  this.mimeTypes = {
      '.html': 'text/html',
      '.js': 'text/javascript',
      '.css': 'text/css',
      '.json': 'application/json',
      '.pdf': 'application/pdf',
      '.png': 'image/png',
      '.jpg': 'image/jpg',
      '.gif': 'image/gif',
      '.wav': 'audio/wav',
      '.mp4': 'video/mp4',
      '.woff': 'application/font-woff',
      '.ttf': 'application/font-ttf',
      '.eot': 'application/vnd.ms-fontobject',
      '.otf': 'application/font-otf',
      '.svg': 'application/image/svg+xml',
      '.docx': 'application/docx'
  };
}

requestIn(request, response) {  // public: requests start here
  this.sessions.log(request, response);   // log request in memory and in log files. Also add cookies for sessionKey and serverStart to response

  // make sure configuration file for web is loaded
  const host = request.headers.host.split(":")[0];  // get rid of port# if it is there
  if ( this.config.hosts[host] ) {
    if (request.method === "POST") {
      // talk to this web server or upstream server, return result to client
      this.POST(request, response);
    } else {
      // serve static file
      this.serveFile(request, response);
    }
  } else {
    // error, configuration file not loaded
    response.writeHead(200, { 'Content-Type': "text/html" });
    response.end(`configuration file: ${host}.json not found`);
  }
}

loadConfiguration(){ // private:
  // configuration file
  const config  = require('./config/_config.json');   // ports, domains served, etc on server
  config.maxSessionAge.totalMilliSec = 0;
  if (config.maxSessionAge.minutes) {config.maxSessionAge.totalMilliSec += config.maxSessionAge.minutes * 60 * 1000;}
  if (config.maxSessionAge.seconds) {config.maxSessionAge.totalMilliSec += config.maxSessionAge.seconds * 1000;}

  for(var h in config.hosts) {
    // load all domain configurations contained in _config.json
    try {
      const f = `./config/${h}.json`;
      console.log('loading configfile: '+ f);
      config.hosts[h]  = require(f);
    } catch (e) {
      console.log(e);
    } finally {
      continue;  // do next iteration even if thow/catch happens
    }
  }
  return config;
}

serveFile(request, response) { // private:serve static file. could be html, JSON, etc
    // serve the default application
    const hostName = request.headers.host.split(":")[0];  // just want hostname, without port #
    const subApp = request.url.split("/")[1];             // get the directory or application name
    const subAppConfig = this.config.hosts[hostName].subApps[ subApp ];  // try to get config for an application
    let filePath;

    let url = request.url;
    if (url.indexOf('?') > -1) {
      url = url.slice(0,url.indexOf('?')); // If there's a question mark, remove it and anything after it
    }

    if (subAppConfig) {
      // use subApps direcrtory
      if (subApp.length +2 == url.length ) {
        filePath = subAppConfig.filePath + "/app.html";
      } else {
        filePath = subAppConfig.filePath + url.substr(subApp.length+1);
      }
      // assume it requires login
      // if (! this.sessions.authorizedSubApp(subApp, request, response) ) return;  //
    } else {
      // use domain directory
      if (url === "/") {
        filePath = this.config.hosts[hostName].filePath +"/app.html" ;
      } else {
        filePath = this.config.hosts[hostName].filePath + url;
      }
    }
    console.log("Loading" + filePath);

  // server file
  var extname = String(this.path.extname(filePath)).toLowerCase();
  var contentType = this.mimeTypes[extname] || 'text/html';


  this.fs.readFile(filePath, (error, content) => {
      if (error) {
          // error handing need to get the html error number too,
          if(error.code == 'ENOENT'){
              // file not found
              response.writeHead(404, { 'Content-Type': contentType });
              response.end('{message: "'+filePath+' - file not found"}');
          } else {
              // server error -- 500 is assumed, pull these from the error.()
              response.writeHead(500);
              response.end('Sorry, check with the site admin for error: '+error.code+' ..\n');
          }
      } else {
        // everything ok
        response.writeHead(200, { 'Content-Type': contentType });
        eval( "app.sessions.responseEnd(response, content)" ); // get around scope load issue
        // responseEnd(request, response, content);
      }
  });
}

web(obj, request, response) {  // private: process request
  if (typeof this[obj.msg] === "function") {
    this[obj.msg](obj, request, response);
  }
  else if (typeof this.sessions[obj.msg] === "function") {
    this.sessions[obj.msg](obj, request, response);
  }
  else {
    // get error to user, add to server log
    console.log("Error: server = 'web', message = '%s\n'", obj.msg );
  }
}

POST(request, response) { // private:
  let body = '';
  request.on('data', chunk => {
      body += chunk.toString(); // convert Buffer to string
  });
  request.on('end', () => {
    response.statusCode = 200;
    response.setHeader('Content-Type', 'text/plain');
    var obj = JSON.parse(body);
    switch (obj.server) {
      case "couchDB":
        // const cookie = this.sessions.parseCookies(request); // This method was marked "private", but I don't see any particular reason why - ask about this later
        this.couchdbProxy.request(obj, request, response, obj.DB);
        break;
      case "couchDBNoLogin":
        this.couchdbNoLogin.request(obj, request, response)
        break;
       case "web":
        this.web(obj, request, response);
        break;
      case "pic":
        this.picServer.requestIn(obj, request, response)
        break;
      default:
        // get error to user, add to server log
        console.log("Error server = %s\n", obj.server );
    }
  });
}

error(obj, request, response) {  // private:
  const data = obj.data;
  const errorObj = {
    "data": data,
    "method": "post"
  };

  this.couchdbProxy.request(errorObj, request, response, this.couchConfig.errorDB);
}

publishCalendarMonth(obj, request, response) {  // private:
  const cookie = this.sessions.parseCookies(request);

  // Verify that the request came from a current admin session
  if (cookie.serverStart && cookie.serverStart == this.sessions.serverStart
      && cookie.sessionKey && this.sessions.sessions[cookie.sessionKey]
      && this.sessions.sessions[cookie.sessionKey].admin === true) {
    this.sessions.initRequest(cookie.sessionKey, request, response);
    response.setHeader('Access-Control-Allow-Origin', '*');

    const hostName = request.headers.host.split(":")[0];
    // Increment month by 1 to index from 1 instead of 0 (e.g., Jan = 1 and Dec = 12 instead of Jan = 0 and Dec = 11)
    let path = `${this.config.hosts[hostName].filePath}/calendar/events_${obj.year}-${obj.month + 1}.JSON`;
    this.fs.writeFile(path, obj.data, function(err) {
      if(err) {
        console.log(err);
        this.sessions.responseEnd(response, "Failed");
      } else {
        this.sessions.responseEnd(response, "Succeeded");
      }
    }.bind(this));
  }
}

replicate(requestObj, request, response) { // private:
  const cookie = this.sessions.parseCookies(request);

  if (cookie.serverStart && cookie.serverStart == this.sessions.serverStart
      && cookie.sessionKey && this.sessions.sessions[cookie.sessionKey]) {

      this.sessions.initRequest(cookie.sessionKey, request, response);
      response.setHeader('Access-Control-Allow-Origin', '*');

      const obj = {
      "path": `/${this.config[this.config.couchDB].replicateDB}`,
      "method":   "post"}

      const protocol = this.config[this.config.couchDB].protocol;
      const host = this.config[this.config.couchDB].host;
      const port = this.config[this.config.couchDB].port;
      let portText = "";
      if (port) portText = `:${port}`;

      const url = `${protocol}//${host}${portText}`;
      const auth = this.config[this.config.couchDB].auth.split(":");
      let username = null;
      let password = "";
      if (auth.length > 1) {
        username = auth[0];
        password = auth[1];
      }

      const data = {
        "_id":this.uuidv1(),
        "user_ctx": {
          "name": username,
          "roles": [
            "_replicator",
            "_reader",
            "_writer"
          ]
        },
        "source": {
          "url": `${url}/${requestObj.from}`,
          "headers": {
          }
        },
        "target": {
          "url": `${url}/${requestObj.to}`,
          "headers": {
          }
        },
        "create_target": false,
        "continuous": false,
        "owner":username
      };

      if (requestObj.IDs) {
        data.doc_ids = requestObj.IDs;
      }

      if (requestObj.selector) {
        data.selector = requestObj.selector;
      }

      if (username && password) {
        data.source.headers.Authorization = "Basic " + Buffer(`${username}:${password}`).toString('base64');
        data.target.headers.Authorization = "Basic " + Buffer(`${username}:${password}`).toString('base64');
      }

      app.couchDB.request(obj, JSON.stringify(data))
      .then(function(answer) {
        this.sessions.responseEnd(response, JSON.stringify(answer));
      }.bind(this));
  } else {
    response.end("Not Logged In");
  }
}

getFromHarmonyByID(obj, request, response) { // private:
  const IDs = obj.IDs;
  const cookie = this.sessions.parseCookies(request);

  if (cookie.serverStart && cookie.serverStart == this.sessions.serverStart
      && cookie.sessionKey && this.sessions.sessions[cookie.sessionKey]) {
    const obj = {
      "path": `/${this.couchConfig.mainDB}/_find`,
      "method": "post"
    };

    const data = JSON.stringify({"selector": {"_id": {"$in":IDs}}});

    app.couchDB.request(obj, data) // see if userid, password match a user in db
    .then(function(result) {
      this.sessions.responseEnd(response, JSON.stringify(result));
    }.bind(this));
  } else {
    response.end("Not Logged In");
  }
}

getFileNames(obj, request, response) {
  const data = obj.data;
  const directory = this.getDirectory(request);

  const path = `${directory}/${data.path}`;
  console.log(path);

  this.checkDirectory(path);
  const fileNames = this.fs.readdirSync(path);
  this.sessions.responseEnd(response, JSON.stringify(fileNames));
}

checkDirectory(path) {
  const steps = path.split("/");
  let partialPath = steps[0];
  steps.splice(0, 1);
  steps.forEach(function(step) {
    partialPath += `/${step}`;
    if (!this.fs.existsSync(partialPath)) {
      this.fs.mkdirSync(partialPath);
    }
  }.bind(this));
}

upload(obj, request, response) {
  const directory = this.getDirectory(request);
  const path = `${directory}/${obj.path}/${obj.name}.${obj.extension}`;

  let fileBinaryArray = [];
  Object.keys(obj.data).map(function(key){
    fileBinaryArray[key] = obj.data[key];
  });

  this.verifyPath(`${directory}/${obj.path}`) // Make sure the file path exists
  .then(this.callbackPromise.bind(this, app.fs.writeFile, path, Buffer.from(fileBinaryArray))) // save the file using app.fs.writeFile
  .then(app.sessions.responseEnd.bind(this, response, "Succeeded")) // Report success to the client
  .catch(function(err) { // Report failure to the client
    app.sessions.responseEnd(response, `Failed: ${err}`);
  }.bind(this));
}

verifyPath(path) { // public: Given a path, creates it if it doesn't already exists, and returns a promise that resolves when finished.
  return new Promise(function(resolve, reject) { // Create the folder path if necessary
    if (!app.fs.existsSync(path)) {
      app.fs.mkdir(path, {recursive: true}, (err) => {
        if (err) {
          console.log(err);
          reject(err);
        } else {
          resolve();
        }
      });
    } else {
      resolve();
    }
  }.bind(this))
}

callbackPromise(func, ...args) { // public: converts any callback function to a promise which resolves or rejects when the function has run
  return new Promise(function(resolve, reject) {
    func(...args, function(err) {
      if (err) {
        console.log(err);
        reject(err);
      } else resolve();
    }); // end callback and function
  }) // end Promise
}

saveEdit(obj, request, response) {
  const data = obj.data;
  const value = data.value;
  const user = data.user;
  const name = data.name || "_";
  const extension = data.extension || "JSON";
  const folder = data.folder || `Content/${data.page}/`;

  const path = `${this.getDirectory(request)}/${folder}${name}.${extension}`
  const now = new Date();
  let archive = `${this.getDirectory(request)}/${folder}${now.toLocaleDateString().replace(/\//g,'-')}_${name}_${user}.${extension}`;

  // First make sure the folder exists (since path and archive go in the same folder, I only need to do this once)
  this.verifyPath(`${this.getDirectory(request)}/${folder}`.slice(0,-1))
  .then(function() { // Then if the old file exists, move it to the archive
    if (this.fs.existsSync(path)) {
      return this.callbackPromise(this.fs.rename, path, archive);
    }
    else return Promise.resolve();
  }.bind(this))
  .then(this.callbackPromise.bind(this, this.fs.writeFile, path, value)) // Then write the new data to the current path
  .then(this.sessions.responseEnd.bind(this, response, "Succeeded")) // Then alert the user that the edit was saved successfully
  .catch(function(err) { // If there was a problem, log it and send the error message back to the user
    console.log(err);
    this.sessions.responseEnd(response, JSON.stringify(err));
  }.bind(this));
}

getDirectory(request) {
  const hostName = request.headers.host.split(":")[0];
  const subApp = request.url.split("/")[1];             // get the directory or application name
  const subAppConfig = this.config.hosts[hostName].subApps[ subApp ];  // try to get config for an application
  let directory = `${this.config.hosts[hostName].filePath}`;
  if (subAppConfig) {
    directory = `${subAppConfig.filePath}`;
  }
  return directory;
}

removeDBSuffix (idString) {
	let newID = idString;
	if (typeof idString === "string") {
		const parts = idString.split("_X_");
		if (parts.length > 1) {
			parts.pop();
			newID = parts.join("_X_");
		}
	}

	return newID;
}

addDBSuffix (idString, DB) {
	if (!DB) DB = this.login.DB;

	let newID = idString;
	if (typeof idString === "string" && idString.indexOf('_X_') === -1) {
		newID = `${idString}_X_${DB}`;
  }
	return newID;
}
} //////// end of class def
