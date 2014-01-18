var Q = require("q");
var _ = require("lodash");
var request = require("request");
var Queue = require("q/queue");
var url = require("url");
var path = require("path");

function Replicator(options) {
	this.options = options;
	this.queue = new Queue();
	this.queueLen = 0;

	for (var i=0;i<this.options.concurrency;i++) {
		this.queue.put();
	}
	// this._replicateLoop();
	_.bindAll(this);
}


Replicator.prototype = {
	setup: function() {
		var urlObj = url.parse(this.options.target);

		var setup = [
			this._putJson(this.options.targetBase + "/_config/vhosts/" + encodeURIComponent(this.options.setup), "/registry/_design/app/_rewrite"),
			this._putJson(this.options.target).catch(function(err){}),
			this._putJson(this.options.targetBase + "/_config/httpd/secure_rewrites", "false")
		];
		return Q.all(setup);
	},
	replicate: function(revisions) {
		var self = this;
		var revs = [];
		_.each(revisions, function(obj, id){
			_.each(obj.missing, function(rev){
				revs.push({
					id: id,
					rev: rev
				});
				self.queueLen++;
			});
		});
		if (self.options.noAttachments) {
			return Q.all(revs.map(self._replicateWithNoAttachments));
		} else {
			return Q.all(revs.map(self._replicateWithAttachments));
		}
	},
	changes: function(since) {
		return this._getJson(this.options.source + "/_changes?since=" + (since||0))
		.then(this._processChanges);
	},
	index: function() {
		return rep._getJson(this.options.target + "_design/app/_rewrite");
	},
	missing: function(revs) {
		return this._postJson(this.options.target + "/_revs_diff", revs);
	},
	_replicateLoop: function(){
		return this.queue.get()
		.then(this._replicate)
		.then(this._replicateLoop);
	},
	_processChanges: function(json) {
		var out = {};
		_.each(json.results, function(res) {
			out[res.id] = res.changes.map(function(change) {
				return change.rev;
			});
		});
		return out;
	},
	_replicateWithAttachments: function(doc) {
		var defer = Q.defer();

		var getUrl = self.options.source + "/" + encodeURIComponent(doc.id)
				+ "?revs=true&attachments=true&rev=" + encodeURIComponent(doc.rev);

		var getUrl = self.options.target + "/" + encodeURIComponent(doc.id)
				+ "?new_edits=false&rev=" + encodeURIComponent(doc.rev);


		var get = request.get({
			uri: getUrl,
			headers: {
				'accept': "multipart/related,application/json"
			}
		});

		var put = request.put({
			uri: putUrl
		}, function(err, res, body) {
			if (err) {
				defer.reject({error: err, doc: doc, body: body});
			} else if (res.statusCode > 199 && res.statusCode < 300) {
				defer.resolve();
			} else {
				defer.reject({error: "Non-200 status: " + res.statusCode, doc: doc, body: body});
			}
		});

		get.pipe(put);

	},
	_replicateWithNoAttachments: function(doc) {
		var self = this;
		return self.queue.get()
		.then(function(){
			var docUrl = self.options.source + "/" + encodeURIComponent(doc.id)
				+ "?revs=true&rev=" + encodeURIComponent(doc.rev);
			return self._getJson(docUrl);
		})
		.then(self._processJson)
		.then(function(json){
			var docUrl = self.options.target + "/" + encodeURIComponent(doc.id)
				+ "?new_edits=false&rev=" + encodeURIComponent(doc.rev);
			return self._putJson(docUrl, json);
		})
		.thenResolve(null)
		.finally(function(){
			self.queueLen--;
			// console.log("DONE: " + doc.id + "@" + doc.rev);
			self.queue.put();
		});
	},
	_processJson: function(json) {
		_.each(json.versions, function(vJson){
			var base = path.basename(vJson.dist.tarball);
			if (!vJson.dist.length) {
				vJson.dist.length = (json._attachments && json._attachments[base]) ? json._attachments[base].length||0 : 0;
			}
			json._attachments[base] = {
				length: 0,
				data: "",
				stub: false,
				digest: "md5-1B2M2Y8AsgTpgAmY7PhCfg=="
			};
		});

		json._attachments = _.omit(json._attachments, function(val){
			return val.stub;
		});

		return json;
	},
	_getJson: function(uri) {
		return Q.nfcall(request, uri)
		.spread(this._parseJson);
	},
	_putJson: function(uri, json) {
		return Q.nfcall(request.put, {
			uri:uri,
			body: JSON.stringify(json) || "",
			encoding: null,
			headers: {
				"content-type": "application/json",
				"accept": "application/json"
			}
		})
		.spread(this._parseJson);
	},
	_postJson: function(uri, json) {
		var urlObj = url.parse(uri);
		return Q.nfcall(request.post, {
			uri:uri,
			body: JSON.stringify(json) || "",
			headers: {
				referer: "http://" + urlObj.host,
				"content-type": "application/json",
				"accept": "application/json"
			},
			encoding: null
		})
		.spread(this._parseJson);
	},
	_parseJson: function(res,body) {
		try {
			if (res.statusCode > 199 && res.statusCode < 300) {
				return JSON.parse(body);
			} else {
				return Q.reject(body);
			}
		} catch(err) {
			console.error("Failed to parse json: " +  err.message + "\n" + body.toString());
			return Q.reject(err);
		}
	},
	_processResults: function(json) {
		var res = [];
		_.each(json.results, function(result){
			_.each(result.changes, function(change){
				res.push({
					id: result.id,
					rev: change.rev
				});
			});
		});
		json.results = res;
		return json;
	}
};


module.exports = Replicator;
