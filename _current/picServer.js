/*
  Picture server
*/

module.exports = class picServer {
  constructor (couchConfig, config) {
    // native nodejs module
    this.autorotate = require('jpeg-autorotate');

    this.config = config;
    this.couchConfig = couchConfig;

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

  requestIn(obj, request, response) {  // public: requests start here
    if (request.method === "POST") {
      // talk to this web server or upstream server, return result to client
      this.POST(obj, request, response);
    }
    // else {
    //   // serve static file
    //   this.serveFile(request, response);
    // }
  }

  POST(obj, request, response) { // private: Runs the requested function, assuming it exists
    if (typeof this[obj.msg] === "function") {
      this[obj.msg](obj, request, response);
    }
    else {
      // get error to user, add to server log
      console.log("Error: server = 'pic', message = '%s\n'", obj.msg );
    }
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
    .then(this.tryToRotate.bind(this, path)) // Rotate the file and resave if necessary; catch the errors that pop up for some reason if it didn't need rotating
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

  tryToRotate(path) { // public: Attempts to rotate a file. If successful (the file needed to be, and could be, rotated), saves the file again. If unsuccessful, returns Promise.resolve for any errors resulting from the file not needing to be rotated, and Promise.reject(err) if something actually went wrong.
    return this.autorotate.rotate(path, {quality: 100})
    .then(function({buffer, orientation, dimensions, quality}) { // Save the file AGAIN because I'm pretty sure the autorotation doesn't do that
      if (buffer) {
        return this.callbackPromise(app.fs.writeFile, path, buffer);
      } else {
        return Promise.resolve();
      }
    }.bind(this))
    .catch(function(err) {
      // The only REAL error autorotate can produce is rotate_file - all the others are various flavors of "I didn't (have to) TRY to rotate this"
      if (err.code === this.autorotate.errors.rotate_file) return Promise.reject(err);
      else return Promise.resolve({});
    }.bind(this));
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

  getDirectory(request) { // public: gets and returns the filepath for the current page
   const hostName = request.headers.host.split(":")[0];
   const subApp = request.url.split("/")[1];             // get the directory or application name
   const subAppConfig = this.config.hosts[hostName].subApps[ subApp ];  // try to get config for an application
   let directory = `${this.config.hosts[hostName].filePath}`;
   if (subAppConfig) {
     directory = `${subAppConfig.filePath}`;
   }
   return directory;
  }

  // serveFile(request, response) { // private:serve static file. May be used for images later, if we can't get them from the regular server like we can now
  //     // serve the default application
  //     const hostName = request.headers.host.split(":")[0];  // just want hostname, without port #
  //     const subApp = request.url.split("/")[1];             // get the directory or application name
  //     const subAppConfig = this.config.hosts[hostName].subApps[ subApp ];  // try to get config for an application
  //     let filePath;
  //
  //     let url = request.url;
  //     if (url.indexOf('?') > -1) {
  //       url = url.slice(0,url.indexOf('?')); // If there's a question mark, remove it and anything after it
  //     }
  //
  //     if (subAppConfig) {
  //       // use subApps direcrtory
  //       if (subApp.length +2 == url.length ) {
  //         filePath = subAppConfig.filePath + "/app.html";
  //       } else {
  //         filePath = subAppConfig.filePath + url.substr(subApp.length+1);
  //       }
  //     } else {
  //       // use domain directory
  //       if (url === "/") {
  //         filePath = this.config.hosts[hostName].filePath +"/app.html" ;
  //       } else {
  //         filePath = this.config.hosts[hostName].filePath + url;
  //       }
  //     }
  //     console.log("Loading" + filePath);
  //
  //   // server file
  //   var extname = String(app.path.extname(filePath)).toLowerCase();
  //   var contentType = this.mimeTypes[extname] || 'text/html';
  //
  //
  //   app.fs.readFile(filePath, (error, content) => {
  //       if (error) {
  //           // error handing need to get the html error number too,
  //           if(error.code == 'ENOENT'){
  //               // file not found
  //               response.writeHead(404, { 'Content-Type': contentType });
  //               response.end('{message: "'+filePath+' - file not found"}');
  //           } else {
  //               // server error -- 500 is assumed, pull these from the error.()
  //               response.writeHead(500);
  //               response.end('Sorry, check with the site admin for error: '+error.code+' ..\n');
  //           }
  //       } else {
  //         // everything ok
  //         response.writeHead(200, { 'Content-Type': contentType });
  //         eval( "app.sessions.responseEnd(response, content)" ); // get around scope load issue
  //         // responseEnd(request, response, content);
  //       }
  //   });
  // }

  // getFileNames(obj, request, response) {
  //   const data = obj.data;
  //   const directory = this.getDirectory(request);
  //
  //   const path = `${directory}/${data.path}`;
  //   console.log(path);
  //
  //   this.checkDirectory(path);
  //   const fileNames = app.fs.readdirSync(path);
  //   app.sessions.responseEnd(response, JSON.stringify(fileNames));
  // }
  //
  // checkDirectory(path) {
  //   const steps = path.split("/");
  //   let partialPath = steps[0];
  //   steps.splice(0, 1);
  //   steps.forEach(function(step) {
  //     partialPath += `/${step}`;
  //     if (!app.fs.existsSync(partialPath)) {
  //       app.fs.mkdirSync(partialPath);
  //     }
  //   }.bind(this));
  // }

  // saveEdit(obj, request, response) {
  //   const data = obj.data;
  //   const value = data.value;
  //   const user = data.user;
  //   const name = data.name || "_";
  //   const extension = data.extension || "JSON";
  //   const folder = data.folder || `Content/${data.page}/`;
  //
  //   const path = `${this.getDirectory(request)}/${folder}${name}.${extension}`
  //   const now = new Date();
  //   let archive = `${this.getDirectory(request)}/${folder}${now.toLocaleDateString().replace(/\//g,'-')}_${name}_${user}.${extension}`;
  //
  //   // First make sure the folder exists (since path and archive go in the same folder, I only need to do this once)
  //   new Promise(function(resolve, reject) {
  //     const folderPath = `${this.getDirectory(request)}/${folder}`.slice(0,-1);
  //     if (!app.fs.existsSync(folderPath)) {
  //       app.fs.mkdir(folderPath, {recursive: true}, (err) => {
  //        if (err) throw err;
  //        resolve();
  //      });
  //     }
  //     else resolve();
  //   }.bind(this))
  //   // Then rename the existing file, if it exists
  //   .then(function() {
  //     return new Promise(function(resolve, reject) {
  //       if (app.fs.existsSync(path)) {
  //         app.fs.rename(path, archive, err => {
  //           if (err) reject(`error in rename:${err}; path:${path}; archive:${archive}`);
  //           else resolve();
  //         });
  //       }
  //       else resolve();
  //     }.bind(this)) // end promise
  //   }.bind(this)) // end then
  //   // Then save the new file
  //   .then(function() {
  //     return new Promise(function(resolve, reject) {
  //       app.fs.writeFile(path, value, function(err) {
  //         if (err) reject(`error in write:${err}; path:${path}`);
  //         else resolve();
  //       }.bind(this)); // end writeFile callback
  //     }.bind(this)); // end promise
  //   }.bind(this)) // end then
  //   // Then respond to the user
  //   .then(function() {
  //     app.sessions.responseEnd(response, "Succeeded");
  //   }.bind(this))
  //   // If anything went wrong, log the error and respond with "Failed"
  //   .catch(function(err) {
  //     console.log(err);
  //     app.sessions.responseEnd(response, JSON.stringify(err));
  //   }.bind(this));
  // }

} //////// end of class def
