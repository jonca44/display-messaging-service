const assert = require("assert"),
      request = require("request"),
      serverKey = process.env.SERVERKEY,
      baseUrl = process.env.SERVER_URL || "https://display-messaging.risevision.com",
      serverUrl = baseUrl + ":" + (process.env.TRUSTED_PORT || "3001"),
      clientUrl = baseUrl + ":" + (process.env.UNTRUSTED_PORT || "443"),
      wsClient = require("../ws-client.js");

describe("Restart", function() {
  this.timeout(5000);

  it("relays a restart message to a display", ()=>{
    let displayId = String(Math.random()),
        displayUrl = clientUrl + "?displayId=" + displayId,
        fakeDisplay = wsClient.createClient(displayUrl),
        rebootUrl = serverUrl + "?sk=" + serverKey + "&did=" + displayId + "&msg=restart";

    return new Promise((res)=>{
      fakeDisplay.on("open", ()=>{
        fakeDisplay.on("data", (data)=>{
          if (data.msg === "restart-request" && data.displayId === displayId) {
            fakeDisplay.end();
            res();
          }
        });

        request(rebootUrl, (err, res, body)=>{
          if(err || res.statusCode !== 200) {
            console.log("Restart request error", err || res.statusCode);
          }
        });
      });
    });
  });
});
