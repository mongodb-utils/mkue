
var MongoClient = require('mongodb').MongoClient
var assert = require('assert')

var Queue = require('..')

var queue = Queue()
queue.delay(10)
queue.run()
var db

before(function (done) {
  MongoClient.connect('mongodb://localhost/mkuetest', function (err, _db) {
    assert.ifError(err)
    assert(db = _db)
    db.dropDatabase()
    queue.collection = db.collection('test1')
    done()
  })
})

it('should ensure an index', function () {
  return queue.ensureIndexes()
})

it('should work with a default function', function () {
  queue.define(function (options) {
    return options.value * 5
  })

  return queue.dispatch({
    value: 1
  }).then(function (res) {
    return queue.poll({
      value: 1
    }, 100)
  }).then(function (job) {
    assert.equal(job.result, 5)
  })
})

it('should work with a namespaced function', function () {
  queue.define('asdf', function (options) {
    return options.value * 5
  })

  return queue.dispatch('asdf', {
    value: 1
  }).then(function (res) {
    return queue.poll('asdf', {
      value: 1
    }, 100)
  }).then(function (job) {
    assert.equal(job.result, 5)
  })
})

it('should catch errors', function () {
  queue.define('error', function (options) {
    throw new Error('boom')
  })

  return queue.dispatch('error', {
    value: 1
  }).then(function () {
    return queue.poll('error', {
      value: 1
    })
  }).then(function (job) {
    assert.equal(job.error.message, 'boom')
  })
})

it('should .get() the latest value', function () {
  return queue.get('asdf', {
    value: 1
  }).then(function (job) {
    assert(job.result)
  })
})

it('.queued() should return the number of queued results', function () {
  return queue.queued().then(function (count) {
    assert(typeof count === 'number')
  })
})

it('.processing() should return the number of jobs currently being processed', function () {
  return queue.processing().then(function (count) {
    assert(typeof count === 'number')
  })
})

it('.close() should stop workers', function () {
  queue.close()
})

it('.cleanup() should unset any processing jobs', function () {
  return queue.cleanup()
})
