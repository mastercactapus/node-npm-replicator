#npm-replicator

This is a simple couchdb replicator that will optionally strip attachments.
Since the public npm registry is <600MB without attachments, it may make
some sense to only replicate the package docs, and pull the actuall attachments
only when needed.

Usage: (as of v0.0.3)
---

  Usage: npm-replicator [options]

  Options:

    -h, --help               output usage information
    -V, --version            output the version number
    -s, --source <URL>       Database to replicate from [http://isaacs.iriscouch.com/registry]
    -t, --target <URL>       Database to replicate to [http://localhost:5984/registry]
    -n, --no-attachments     Replicate attachments as 0-byte stubs (use something like varnish to route to mirrors)
    -c, --concurrency [NUM]  Number of documents replicating at a time [48]
    -m, --max-sockets [NUM]  Max tcp sockets to use during replication [24]
    --setup [HOST]           Intended to configure a fresh couchdb server as a private npm registry
    --user [USER]            Username for target couchdb server (environment variable AUTH_USER as alternative)
    --pass [PASS]            Password for target couchdb server (environment variable AUTH_PASS as alternative)



To facilitate this it is recommended to put varnish in front of your couchdb.


Example Varnish Config
---

	backend default {
		.host = "127.0.0.1";
		.port = "5984";
	}
	backend npmjs {
		.host = "registry.npmjs.org";
		.port = "80";
	}

	sub vcl_fetch {
		if ((beresp.status == 200) && (beresp.content-length != "0")) {
			set beresp.do_gzip = true;
			set beresp.do_stream = true;
		} elsif ((req.url ~ "\.tgz$") && (req.restarts == 1)) {
			return (restart);
		} else {
			error 404 "Could not find package archive";
		}

		if (req.url ~ "\.tgz$") {
			beresp.ttl = 30d;
		}
	}

	sub vcl_recv {
		if (req.restarts == 0) {
			set req.backend = default;
			set req.http.host = "your.couch.vhost.name";
		} else {
			set req.backend = npmjs;
			set req.http.host = "registry.npmjs.org";
		}
		if (req.request == "GET" || req.request == "HEAD") {
			return (lookup);
		} else {
			return (pass);
		}
	}
