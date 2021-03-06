const assert = require("assert"),
path = require("path"),
fork = require("child_process").fork,
baseUrl = process.env.SERVER_URL || "https://display-messaging.risevision.com",
clientUrl = baseUrl + ":" + (process.env.UNTRUSTED_PORT || "443"),
displayId = "E2ELONGCONNECTION",
wsClient = require("../ws-client.js");

describe("Long Connection", function() {
  this.timeout(5000);

  it("has a long standing connection", ()=>{
    return checkLongStandingConnection()
    .catch(createLongStandingConnection);
  });
});


function checkLongStandingConnection() {
  let fakeBrowser = wsClient.createClient(clientUrl);
  return new Promise((res, rej)=>{
    fakeBrowser.on("data", function(data) {
      if (data.msg === "client-connected") {
        fakeBrowser.write({msg: "presence-request", "displayIds": [displayId]});
      }
      if (data.msg === "presence-result") {
        fakeBrowser.end();

        if (data.result.some((el)=>{return el[displayId];})) {
          res();
        } else {
          rej();
        }
      }
    });
  });
}

function createLongStandingConnection() {
  let child = fork(path.join(__dirname, "long-connection.js"), [], {stdio: "inherit"});
  child.unref();
  child.disconnect();
  throw new Error("long standing connection not found - new one created");
}
