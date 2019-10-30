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



module.exports = class couchdbProxyNoLogin {

constructor(couchConfig, config) {
  this.http   = require('http');                              // process http requests
  this.https  = require('https');                             // process https requests
  this.uuidv1 = require('uuid/v1');                           // Generate GUIDs
  this.couchConfig = JSON.parse(JSON.stringify(couchConfig)); // comes from config/_config.json
  this.config = config;                                       // general config file
}

request(baseObj, req, response) { // public, proxy interface
  const allowedSubApps = ["order_microgreens", "order_microgreensBeta", "", "beta"];

  let subapp = req.headers.referer // ex. "https://local.etpri.org:8443/order_microgreens/"
    .replace(req.headers.origin, "") // ex. "/order_microgreens/"
    .split("/") // ex. ["/", "order_microgreens", "/"]
    [1]; // ex. order_microgreens

  if (subapp.startsWith("?")) subapp = ""; // Distinguish between a query string and an actual subapp

  if (allowedSubApps.includes(subapp) && typeof this[baseObj.function] === "function") {
    this[baseObj.function](baseObj).then(function(obj) {
      if (obj.error) {
        app.sessions.responseEnd(obj.error);
      }

      else {
        const hostName = req.headers.host.split(":")[0]; // ex. local.etpri.org
        this.couchConfig.DB = this.config.hosts[hostName].mainDB; // Use the main database for this site

        this.couchConfig.method = obj.method;
        if (obj.message) {
          this.couchConfig.path = `/${this.couchConfig.DB}/${obj.message}`;
        }
        else {
          this.couchConfig.path = `/${this.couchConfig.DB}`;
        }

        app.sessions.responseAddProxy( response, {proxy: "couchDB", method: obj.method, path: this.couchConfig.path, data: obj.data} );

        if (["https:", "http:"].includes(this.couchConfig.protocol)) {
          return this.requestProtocol(obj.data, response);
        }
        else {
          throw("error, looking for http or https, protocol =  " + this.couchConfig.protocol);
        }
      } // end else (function did NOT raise an error)
    }.bind(this))
  } // end if (subapp is allowed and function exists)
  else if (!allowedSubApps.includes(subapp)) {
    app.sessions.responseEnd(response, "No permission");
  }
  else {
    app.sessions.responseEnd(response, "Invalid function");
  }
}

/*******************************************************************************
Start of functions the client can call
*******************************************************************************/

findPerson(baseObj) {
  const selector = {"meta.s_type":"people"};
  ["s_nameFirst", "s_nameLast", "l_email", "s_PhoneMobile", "s_phoneHome", "s_Office"].forEach(att => {
    if (baseObj[att]) selector[`data.${att}`] = baseObj[att];
  })

  const data = {"selector":selector, "limit":2};
  return Promise.resolve({"message":"_find", "method":"POST", "data": JSON.stringify(data)});
}

createPerson(baseObj) {
  if (!baseObj.s_name) baseObj.s_name = `${baseObj.s_nameLast},${baseObj.s_nameFirst}`;
  delete baseObj.function;
  delete baseObj.server;

  const data = {
    "_id": this.uuidv1(),
    "data": baseObj,
    "meta":{"s_type":"people"}
  }
  return Promise.resolve({"method":"post", "data":JSON.stringify(data)});
}

updatePerson(baseObj) {
  const ID = baseObj.ID;
  delete baseObj.ID;

  return this.getNode(ID)
  .then(function(nodeString) {
    const nodeData = JSON.parse(nodeString);
    if (nodeData.meta.s_type === "people") {
      delete baseObj.function;
      delete baseObj.server;
      Object.keys(baseObj).forEach(key=>{
        nodeData.data[key] = baseObj[key];
      })

      return Promise.resolve({"message":ID, "method":"put", "data":JSON.stringify(nodeData)});
    }
    else {
      return Promise.resolve({"error":"Not a person"});
    }
  })
}

findInterests(baseObj) {
  const selector = {"meta.s_type": "interest", "data.d_end":{"$exists":false}};
  ["k_toID", "k_fromID"].forEach(att =>  {
    if (baseObj[att]) selector[`data.${att}`] = baseObj[att];
  })

  const data = {"selector":selector, "limit":50};
  return Promise.resolve({"message":"_find", "method":"POST", "data": JSON.stringify(data)});
}

createInterest(baseObj) {
  delete baseObj.function;
  delete baseObj.server;

  const data = {
    "_id": this.uuidv1(),
    "data": baseObj,
    "meta":{"s_type":"interest"}
  }
  return Promise.resolve({"method":"post", "data":JSON.stringify(data)});
}

updateInterest(baseObj) {
  const ID = baseObj.ID;
  delete baseObj.ID;
  return this.getNode(ID)
  .then(function(nodeString) {
    const nodeData = JSON.parse(nodeString);
    if (nodeData.meta.s_type === "interest") {
      delete baseObj.function;
      delete baseObj.server;
      Object.keys(baseObj).forEach(key=>{
        nodeData.data[key] = baseObj[key];
      })

      return Promise.resolve({"message":ID, "method":"put", "data":JSON.stringify(nodeData)});
    }
    else {
      return Promise.resolve({"error":"Not an interest"});
    }
  })
}

deleteInterest(baseObj) {
  return this.getNode(baseObj.ID)
  .then(function(nodeString) {
    const nodeData = JSON.parse(nodeString);
    if (nodeData.meta.s_type === "interest") {
      nodeData.data.d_end = Date.now();

      return Promise.resolve({"message":baseObj.ID, "method":"put", "data":JSON.stringify(nodeData)});
    }
    else {
      return Promise.resolve({"error":"Not an interest"});
    }
  })
}

findOrders(baseObj) {
  const selector = {"meta.s_type": "order", "data.k_toID":baseObj.orderNode, "data.k_fromID":baseObj.person};

  const data = {"selector":selector, "limit":50};
  return Promise.resolve({"message":"_find", "method":"POST", "data": JSON.stringify(data)});
}

getAllOrders(baseObj) {
  const selector = {"meta.s_type": "order", "data.k_toID":baseObj.orderNode};

  const data = {"selector":selector, "limit":50};
  return Promise.resolve({"message":"_find", "method":"POST", "data": JSON.stringify(data)});
}

deleteOrder(baseObj) { // Given a node's ID, get that node, verify that it's an order, then add a d_end to it.
  return this.getNode(baseObj.ID)
  .then(function(nodeString) {
    const nodeData = JSON.parse(nodeString);
    if (nodeData.meta.s_type === "order") {
      nodeData.data.d_end = Date.now();

      return Promise.resolve({"message":baseObj.ID, "method":"put", "data":JSON.stringify(nodeData)});
    }
    else {
      return Promise.resolve({"error":"Not an order"});
    }
  })
}

restoreOrder(baseObj) {
  return this.getNode(baseObj.ID)
  .then(function(nodeString) {
    const nodeData = JSON.parse(nodeString);
    if (nodeData.meta.s_type === "order") {
      delete nodeData.data.d_end;

      return Promise.resolve({"message":baseObj.ID, "method":"put", "data":JSON.stringify(nodeData)});
    }
    else {
      return Promise.resolve({"error":"Not an order"});
    }
  })
}

markPaid(baseObj) { // Given a node's ID, get that node, verify that it's an order, then set its b_paid attribute to true.
  return this.getNode(baseObj.ID)
  .then(function(nodeString) {
    const nodeData = JSON.parse(nodeString);
    if (nodeData.meta.s_type === "order") {
      nodeData.data.b_paid = true;

      return Promise.resolve({"message":baseObj.ID, "method":"put", "data":JSON.stringify(nodeData)});
    }
    else {
      return Promise.resolve({"error":"Not an order"});
    }
  })
}

createOrder(baseObj) {
  if (baseObj.data.meta.s_type === "order") {
    baseObj.data.data.d_start = Date.now();
    if (!baseObj.data._id) { // If it doesn't already have an ID...
      baseObj.data._id = this.uuidv1(); // Give it a GUID...
    }

    return Promise.resolve({"method":"post", "data":JSON.stringify(baseObj.data)});
  }
  else {
    return Promise.resolve({"error":"Not an order"});
  }
}

changeQuantity(baseObj) {
  return this.getNode(baseObj.ID)
  .then(function(nodeString) {
    const nodeData = JSON.parse(nodeString);
    if (nodeData.meta.s_type === "order") {
      nodeData.data.i_quantity = baseObj.quantity;

      return Promise.resolve({"message":baseObj.ID, "method":"put", "data":JSON.stringify(nodeData)});
    }
    else {
      return Promise.resolve({"error":"Not an order"});
    }
  })
}

/*******************************************************************************
End of functions the client can call
*******************************************************************************/

getNode(ID) {
  this.couchConfig.method = "get";
  this.couchConfig.path = `/${this.couchConfig.DB}/${ID}`;
  return this.sendRequest("", this.couchConfig.protocol.slice(0, -1));
}

sendRequest(data, protocol) {
  let result = "";
  return new Promise(function(resolve, reject) {
    const req = this[protocol].request(this.couchConfig, (res) => {
      res.on('data', (d) => {
        result += d.toString();  // response from couchDB back to client
      });
      res.on('end', () => {
        resolve(result);  // let client know there is no more data
      }) // end res.on
    }); // end req definition

    req.on('error', (e) => reject(e));
    req.end(data);  // Send request to server
  }.bind(this)); // end promise
}

// send to couchDB with HTTPS, the recommended way
requestProtocol(data, response) {  // private, use HTTPS secure transfer
  // make request to server and wait for a response
  this.sendRequest(data, this.couchConfig.protocol.slice(0, -1))
  .then(result => app.sessions.responseEnd(response, result))
  .catch(err => console.error(err));
}
} ///////////// end class
