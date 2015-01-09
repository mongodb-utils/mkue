
var stringify = require('json-stable-stringify')
var wrap = require('mongodb-next').collection
var Promise = require('native-or-bluebird')
var delay = require('timeout-then')
var debug = require('debug')('mkue')
var cleanup = require('exit-then')
var crypto = require('crypto')
var assert = require('assert')
var ms = require('ms')

// random process ID to designate jobs this process is handling
var process_id = crypto.pseudoRandomBytes(16)

/**
{
  // when initialized
  _id: <ObjectID>,
  name: "",
  input: {},
  queued: <Boolean> <sparse>,
  created: <Date>,

  // output
  output: ???,
  error: {},

  // during processing
  started: <Date> <sparse>,
  ended: <Date> <sparse>,
  process_id: <Binary> <sparse>,
  processing: <Boolean> <sparse>,
  processed: <Boolean> <sparse>,
}
*/

module.exports = Queue

function Queue(options) {
  if (!(this instanceof Queue)) return new Queue(options)

  options = options || {}

  if (options.collection) this.collection = options.collection
  this.concurrency(options.concurrency || 1)
  this.delay(options.delay || 1000)
  if (options.dispose) this.dispose()

  // current number of jobs being processed
  this.pending = 0
  // all the functions
  this.fns = Object.create(null)
  // name of all the functions, used to filter queries
  this.names = []

  cleanup.push(this.cleanup.bind(this))
}

/**
 * Lazily set the MongoDB collection.
 * Asserts when you try to use it before it's set.
 */

Object.defineProperty(Queue.prototype, 'collection', {
  set: function (collection) {
    assert(!this._collection, 'A `.collection` is already set!')
    this._collection = wrap(this.rawCollection = collection)
  },
  get: function () {
    assert(this._collection, 'Set `.collection` first!')
    return this._collection
  }
})

/**
 * Set the currency.
 */

Queue.prototype.concurrency = function (count) {
  assert(typeof count === 'number')
  assert(count >= 0)
  this._concurrency = count
  return this
}

/**
 * Dispose the document on success.
 */

Queue.prototype.dispose = function () {
  this._dispose = true
  return this
}

/**
 * Set the delay between batches.
 */

Queue.prototype.delay = function (time) {
  if (typeof time === 'string') time = ms(time)
  assert(time > 0)
  this._delay = time
  return this
}

/**
 * Define a function, optionally with a namespace.
 */

Queue.prototype.define = function (name, fn) {
  if (typeof name === 'function') {
    fn = name
    name = 'default'
  }
  this.fns[name] = fn
  this.names = Object.keys(this.fns)
  return this
}

/**
 * Dispatch a job, optionally with a namespace.
 */

Queue.prototype.dispatch = function (name, input) {
  var doc = args(name, input)
  doc.queued = true
  debug('dispatching %o', doc)
  return this.collection.findOne(doc).upsert({
    name: doc.name,
    input: doc.input,
    hash: doc.hash,
    queued: true,
    created: new Date(),
  }).new()
}

/**
 * Get a job by its ID or name/input.
 */

Queue.prototype.get = function (name, input) {
  if (isObjectID(name)) return this.getById(name);
  return this.getByInput(name, input);
}

/**
 * Get a job by its ID.
 */

Queue.prototype.getById = function (job_id) {
  return this.collection.findOne('_id', job_id)
}

/**
 * Get the latest value of a namespace and option.
 * Note: this requires its own index!
 */

Queue.prototype.getByInput = function (name, input) {
  return this.collection.findOne(args(name, input)).sort({
    created: -1 // newest
  })
}

/**
 * Poll a job.
 */

Queue.prototype.poll = function (name, input, interval) {
  if (isObjectID(name)) return this.pollById(name, input)
  return this.pollByInput(name, input, interval)
}

/**
 * Poll a job by its ID.
 */

Queue.prototype.pollById = function (_id, interval) {
  return this._pollById(_id, this._calculateInterval(interval))
}

Queue.prototype._pollById = function (_id, interval) {
  debug('polling %s', _id)
  var self = this
  return this.collection.findOne('_id', _id).then(function (job) {
    if (job && ('output' in job || 'error' in job)) return job
    return delay(interval).then(function () {
      return self._pollById(_id, interval)
    })
  })
}

/**
 * Poll the latest job until it's done.
 * Polls with interval set in `.delay()`.
 * Note: this requires its own index!
 */

Queue.prototype.pollByInput = function (name, input, interval) {
  if (typeof input === 'number' || typeof input === 'string') {
    interval = input
    input = {}
  }
  return this._pollByInput(args(name, input), this._calculateInterval(interval))
}

Queue.prototype._pollByInput = function (doc, interval) {
  debug('polling %o', doc)
  var self = this
  return this.collection.findOne(doc).sort({
    created: -1 // newest
  }).then(function (job) {
    if (job && ('output' in job || 'error' in job)) return job
    return delay(interval).then(function () {
      return self._pollByInput(doc, interval)
    })
  })
}

/**
 * Call a job.
 */

Queue.prototype.run = function () {
  // already told to stop working
  if (this.closed) return
  // already waiting to execute `.run()` again
  if (this._queue) return
  // reached max concurrency
  if (this.pending >= this._concurrency) return this.queue()
  // no functions can handle this yet
  if (!this.names.length) return this.queue()

  var self = this
  debug('running #%s', ++this.pending)

  this.collection.findOne({
    // only handle functions we can handle
    name: {
      $in: this.names
    },
    queued: true,
  }).unset('queued').set({
    process_id: process_id,
    started: new Date(),
    processing: true,
  }).sort({
    date: 1 // oldest first
  }).new().then(function (job) {
    if (self.closed) return self.pending--;

    if (!job) {
      // no job found, so we wait to poll again
      debug('no job found!')
      self.pending--
      self.queue()
      return
    }

    // found a job, so find another one if we can
    // we don't need to send 5 findandmodify commands at once
    self.run()

    var fn = self.fns[job.name]
    assert(fn)

    // wrapped in a promise to catch and `throws`
    new Promise(function (resolve) {
      resolve(fn(job.input))
    }).then(function (output) {
      if (self._dispose) {
        self.collection.findOne('_id', job._id)
          .remove()
          .catch(self.onerror)
      } else {
        self.collection.findOne('_id', job._id)
          .set('processed', true)
          .unset('processing')
          .set('ended', new Date())
          .set('output', output)
          .catch(self.onerror)
      }

      self.pending--
      self.run()
    }, function (err) {
      self.collection.findOne('_id', job._id)
        .set('processed', true)
        .unset('processing')
        .set('ended', new Date())
        .set('error.message', err.message)
        .set('error.stack', err.stack)
        .catch(self.onerror)

      self.pending--
      self.run()
    })
  }).catch(self.onerror)
}

/**
 * Called when there are no pending jobs.
 * Waits `.delay()`, then finds the next job.
 * Could be called `.timeout()` or `.wait()` something as well.
 */

Queue.prototype.queue = function (timeout) {
  if (this._queue) return
  debug('queueing')
  var self = this
  this._queue = delay(this._calculateInterval(timeout)).then(function () {
    debug('running')
    delete self._queue
    self.run()
  })
}

/**
 * Ensures an index on the current collection for finding the next job.
 * You might want to add additional indexes for retrieving values.
 * Built assuming that your queue is always going to be short.
 */

Queue.prototype.ensureIndexes =
Queue.prototype.ensureIndex = function () {
  return Promise.all([
    this.collection.ensureIndex({
      queued: 1
    }, {
      sparse: true,
      background: true
    }),
    this.collection.ensureIndex({
      processing: 1,
    }, {
      sparse: true,
      background: true
    })
  ])
}

/**
 * Stop doing any more work.
 */

Queue.prototype.close = function () {
  this.closed = true
  return this
}

/**
 * Handler for when a process is about to exit.
 * Marks everything the current
 */

Queue.prototype.cleanup = function () {
  this.closed = true
  // not yet connected, so nothing could have happened
  if (!this._collection) return

  // add queue back to all current processes
  return this.collection.find({
    process_id: process_id,
    processing: true
  })
  .unset('process_id')
  .unset('processing')
  .set('queued', true)
  .set('killed', new Date())
  .w(0) // fire and forget
  .catch(this.onerror)
}

/**
 * Get the number of processing jobs.
 */

Queue.prototype.processing = function () {
  return this.collection.find({
    processing: true
  }).count()
}

/**
 * Get the number of queued jobs.
 */

Queue.prototype.queued = function () {
  return this.collection.find({
    queued: true
  }).count()
}

/**
 * Custom error handler.
 */

/* istanbul ignore next */
Queue.prototype.onerror = function (err) {
  if (err instanceof Error) console.error(err.stack || err.message || err)
}

/**
 * Calculate an interval.
 */

Queue.prototype._calculateInterval = function (interval) {
  if (typeof interval === 'string') interval = ms(interval)
  interval = interval || this._delay
  assert(typeof interval === 'number')
  return interval
}
/**
 * Check the arguments.
 */

function args(name, input) {
  if (typeof name === 'object') {
    input = name
    name = 'default'
  }

  input = input || {}
  assert(typeof name === 'string')
  assert(typeof input === 'object')

  return {
    name: name,
    input: input,
    hash: calculate(name, input),
  }
}

/**
 * Whether an object is an ObjectID.
 */

function isObjectID(obj) {
  return obj && obj.constructor && obj.constructor.name === 'ObjectID'
}

function calculate(name, input) {
  return crypto.createHash('sha256')
    .update(name)
    .update('-')
    .update(stringify(input))
    .digest()
}
