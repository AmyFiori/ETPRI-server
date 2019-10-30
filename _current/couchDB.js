/*

web server uses this class to interact with couchDB

--------------------- API
request(obj, data) { // public, returns a Promise

obj = {
path:  database: blank ->  server, /database -> database
method:   post, put, get, etc.
}

data - stringify JSON object


----------------------- private
from config file
"protocol": "https:",
"auth": "husdowereposteneartingid:b93c38c1482e9ad68e19f04f3a6e9f35e2f6de06",
"host": "ad8d2e73-d414-48c9-92f7-6d12276adeea-bluemix.cloudant.com",
"headers": {"Content-Type": "application/json"}

*/

module.exports = class couchDB {

constructor(server) {
  this.https  = require('https');     // process https requests
  this.http   = require('http');      // process http requests (should only be used for local testing)
  this.server = server;               // comes from config/_config.json
}

//////////////////////////////////////////////////////// interface direct to couchDB

request(obj, data) { // public, returns a Promise
  this.server.path   = obj.path;
  this.server.method = obj.method;
  if (       this.server.protocol == "https:") {
     return this.requestHTTPS(data);
  } else if (this.server.protocol == "http:" ) {
     return this.requestHTTP (data);
  } else {
   throw("error, looking for http or https, protocol =  " + this.server.protocol);
  }
}


requestHTTPS(data) {
  var response = "";
  return new Promise( (resolve, reject) => {
    const req = this.https.request(this.server, (res) => {
      res.on('data', (d) => {
        response += d.toString();
      });
      res.on('end', () => {
        resolve( JSON.parse(response) );
      });
    });

    req.on('error', (e) => {
      console.error(e);
    });
    req.end(data);
  });
}

requestHTTP(data) {  // public, returns a Promise
  var response = "";
  return new Promise( (resolve, reject) => {
    const req = this.http.request(this.server, (res) => {
      res.on('data', (d) => {
        response += d.toString();
      });
      res.on('end', () => {
        resolve( JSON.parse(response) );
      });
    });

    req.on('error', (e) => {
      console.error(e);
    });
    req.end(data);
  });
}

} ///////////// end class
