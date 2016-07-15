var cluster = require("cluster");
var Primus = require("primus");
var emitter = require("primus-emitter");
var latency = require("primus-spark-latency");
var http = require("http");
var fs = require("fs");
var argv = require("yargs")
  .default({ address: "localhost", port: 3000, workers: 6 })
  .argv;
var server = http.createServer();
var displayServers = {};
var displaysById = {};
var displaysBySpark = {};
var pendingMessages = {};
var pendingTasks = {};
var displayIdsByWorker = {};
var stats = {
  clients: 0,
  newClients: 0,
  disconnectedClients: 0,
  unknownDisconnectedClients: 0,
  newErrors: 0,
  sentMessages: 0,
  savedMessagesSent: 0,
  savedMessages: 0
};

if(cluster.isMaster) {
  var numWorkers = argv.workers;

  console.log("Master cluster setting up " + numWorkers + " workers...");

  for(var i = 0; i < numWorkers; i++) {
    cluster.fork();
  }

  cluster.on("message", (worker, message)=>{
    if(message.connection) {
      displayIdsByWorker[worker.id][message.connection.displayId] = true;
    }
    else if(message.disconnection) {
      delete displayIdsByWorker[worker.id][message.disconnection.displayId];
    }
    else if(message.msg) {
      let workers = Object.keys(displayIdsByWorker);
      let workerId = workers.find((workerId)=>{
        return displayIdsByWorker[workerId][message.msg.displayId];
      }) || workers[Math.floor(Math.random() * workers.length)];

      cluster.workers[workerId].send(message);
    }
    else if(message.stats) {
      stats.clients += (message.stats.newClients - message.stats.disconnectedClients);
      stats.newClients += message.stats.newClients;
      stats.disconnectedClients += message.stats.disconnectedClients;
      stats.unknownDisconnectedClients += message.stats.unknownDisconnectedClients;
      stats.newErrors += message.stats.newErrors;
      stats.sentMessages += message.stats.sentMessages;
      stats.savedMessagesSent += message.stats.savedMessagesSent;
      stats.savedMessages += message.stats.savedMessages;
    }
  });

  cluster.on("online", function(worker) {
    console.log("Worker " + worker.process.pid + " is online");

    displayIdsByWorker[worker.id] = {};
  });

  cluster.on("exit", function(worker, code, signal) {
    console.log("Worker " + worker.process.pid + " died with code: " + code + ", and signal: " + signal);

    delete displayIdsByWorker[worker.id];

    var newWorker = cluster.fork();
    console.log("Starting a new worker " + newWorker.process.pid);
  });

  startStats();
}
else {
  registerPrimusEventListeners(startPrimus());
  startStats();
  startServer();
}

function startPrimus() {
  var primus = new Primus(server, { transformer: "uws", use_clock_offset: true, iknowclusterwillbreakconnections: true });

  primus.use("emitter", emitter);
  primus.use("spark-latency", latency);

  return primus;
}

function registerPrimusEventListeners(primus) {
  process.on("message", (message)=>{
    if(message.msg) {
      let data = message.msg;

      if(displaysById[data.displayId]) {
        stats.sentMessages++;
        displaysById[data.displayId].send("message", data.message);
      }
    }
  });

  primus.on("connection", function(spark) {
    spark.on("end", function() {
      if(displayServers[spark.id]) {
        delete displayServers[spark.id];
      }
      else if(displaysBySpark[spark.id]) {
        stats.clients--;
        stats.disconnectedClients++;

        var displayId = displaysBySpark[spark.id];

        delete displaysById[displayId];
        delete displaysBySpark[spark.id];
        process.send({ disconnection: { displayId: displayId }});
      }
      else {
        stats.unknownDisconnectedClients++;
      }
    });

    spark.on("end", function() {
      stats.newErrors++;
    });

    spark.on("server-init", function () {
      displayServers[spark.id] = spark;
    });

    spark.on("display-init", function (data) {
      if(data.displayId) {
        stats.clients++;
        stats.newClients++;
        displaysById[data.displayId] = spark;
        displaysBySpark[spark.id] = data.displayId;

        process.send({ connection: { displayId: data.displayId }});
      }
    });

    spark.on("presence-request", function(data) {
      if(data.displayId) {
        if(displaysById[data.displayId]) {
          stats.sentMessages++;
          displaysById[data.displayId].send("presence-request");
        }
        else {
          process.send({msg: "presence-request", displayId: data.displayId});
        }
      }
    });
  });
}

function startStats() {
  setInterval(function () {
    if(cluster.isMaster) {
      var currStats = [
        Date.now(), stats.clients, stats.newClients, stats.disconnectedClients, stats.unknownDisconnectedClients,
        stats.newErrors, stats.newGCSErrors, stats.sentMessages, stats.savedMessagesSent, stats.savedMessages
      ].join(",");

      console.log(JSON.stringify(stats));

      fs.appendFile("stats.csv", currStats + "\n", function (err) {
        if(err) { console.log("Error saving stats", err); }
      });
    }
    else {
      process.send({ stats: stats });
    }

    stats.newClients = 0;
    stats.disconnectedClients = 0;
    stats.unknownDisconnectedClients = 0;
    stats.newErrors = 0;
    stats.newGCSErrors = 0;
    stats.sentMessages = 0;
    stats.savedMessagesSent = 0;
    stats.savedMessages = 0;
  }, cluster.isMaster ? 5000 : 1000);
}

function processPendingMessages(displayId) {
  if(pendingMessages[displayId] && pendingMessages[displayId].length > 0) {
    var messages = pendingMessages[displayId].splice(0, pendingMessages[displayId].length);

    return saveGCSMessages(displayId, messages, 3);
  }
}

function runNextTask(displayId) {
  if(pendingTasks[displayId] && pendingTasks[displayId].length > 0) {
    var task = pendingTasks[displayId].shift();

    return Promise.resolve()
    .then(task)
    .catch((err)=>{
      console.log("Error running task", err);
    })
    .then(()=>{
      if(pendingTasks[displayId].length === 0) {
        delete pendingTasks[displayId];
      }
      else {
        return runNextTask(displayId);
      }
    });
  }
}

function startServer() {
  server.listen(argv.port, argv.address, function() {
    console.log("Running on http://" + server.address().address + ":" + server.address().port);
  });
}
