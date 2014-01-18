#!/usr/bin/env node

var Q = require("q");

var http = require("http");
var _ = require("lodash");
var url = require("url");
var path = require("path");
var cli = require("commander");
var Replicator = require("../lib/replicator");

cli
	.version(require("../package").version)
	.option("-s, --source <URL>", "Database to replicate from [http://isaacs.iriscouch.com/registry]", "http://isaacs.iriscouch.com/registry")
	.option("-t, --target <URL>", "Database to replicate to [http://localhost:5984/registry]", "http://localhost:5984/registry")
	.option("-n, --no-attachments", "Replicate attachments as 0-byte stubs (use something like varnish to route to mirrors)", false)
	.option("-c, --concurrency [NUM]", "Number of documents replicating at a time [48]", 48)
	.option("-m, --max-sockets [NUM]", "Max tcp sockets to use during replication [24]", 24)
	.option("--setup [HOST]", "Intended to configure a fresh couchdb server as a private npm registry", null)
	.option("--user [USER]", "Username for target couchdb server (environment variable AUTH_USER as alternative)")
	.option("--pass [PASS]", "Password for target couchdb server (environment variable AUTH_PASS as alternative)")
	.parse(process.argv);

cli.user = cli.user || process.env.AUTH_USER;
cli.pass = cli.pass || process.env.AUTH_PASS;


http.globalAgent.maxSockets = cli.maxSockets;



function status(line){
	process.stderr.clearLine();
	process.stderr.cursorTo(0);
	process.stderr.write(line);
}
console.error("Will replicate " + cli.source + " to " + cli.target);
console.error("Attachments are " + (cli.attachments ? "ON" : "OFF"));
var targetObj = url.parse(cli.target);
if (cli.user && cli.pass && !targetObj.auth) {
	var split = cli.target.split("://");
	targetObj.auth = cli.user + ":" + cli.pass;
	split[1] = targetObj.auth + "@" + split[1];
	cli.target = split.join("://");
}
cli.targetBase = targetObj.protocol + "//" + (targetObj.auth ? targetObj.auth + "@" : "") + targetObj.host;



var interval,rep = new Replicator(cli);

var setup;
if (cli.setup) {
	console.error("Setting up " + cli.target + " to be an npm registry");
	setup = rep.setup();
} else {
	setup = Q();
}

setup.then(function(){
	console.error("Getting change data from " + cli.source);
	return rep.changes(0)
})
.then(function(json){
	console.error("Checking for missing revisions");
	return rep.missing(json);
})
.then(function(json){
	console.error("Replicating documents");
	if (process.stderr.isTTY) {
		interval = setInterval(function(){
			if (rep.queueLen > 0) {
				status(rep.queueLen + " documents to replicate");
			} else {
				status("");
				clearInterval(interval);
			}
		},50);
	} else {
		console.error(rep.queueLen + " documents to replicate");
	}

	return rep.replicate(json);
})
.then(function(){
	clearInterval(interval);
	status("");
	console.error("Triggering view index");
	return rep.index();
})
.then(function(){
	console.error("Replication complete " + rep.count + " documents replicated");
})
.catch(function(err){
	clearInterval(interval);
	console.error()
	console.error(err);
	process.exit(1);
})
.done();


