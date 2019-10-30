/*

small web server that serves static files and a
API to couchDB  (json document database)
API to webserver

*/

// built in nodejs modules
const https    = require('https');  // access to https protocal
const fs       = require('fs');     // access to local server file system

app = new (require('./server.js'))();  // class where the work gets done

// helper functions to get access to app object
function requestIn(  request, response) {app.requestIn(           request, response);}
function responseEnd(request, response) {app.sessions.responseEnd(request, response);}

// server request and reponse loop
https.createServer(
  {
  // https certificates for encription
  key:  fs.readFileSync('certificates/etpri.org.key'),
  cert: fs.readFileSync('certificates/323180705a35f86f.crt'),
  ca: [ fs.readFileSync('certificates/gd_bundle-g2-g1.crt')]
  // passphrase: ''
  },requestIn
).listen(app.config.port);

console.log(`https:// Server using port: ${app.config.port}`);
