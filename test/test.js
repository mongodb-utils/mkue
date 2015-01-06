
var MongoClient = require('mongodb').MongoClient
var Promise = require('native-or-bluebird')
var assert = require('assert')

var Queue = require('..')

var queue = Queue()
queue.delay(10)
queue.run()
var db
var job

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
  queue.define(function (input) {
    return input.value * 5
  })

  return queue.dispatch({
    value: 1
  }).then(function (res) {
    return queue.poll({
      value: 1
    }, 100)
  }).then(function (_job) {
    assert(job = _job)
    assert.equal(job.output, 5)
  })
})

it('should work with a namespaced function', function () {
  queue.define('asdf', function (input) {
    return input.value * 5
  })

  return queue.dispatch('asdf', {
    value: 1
  }).then(function (res) {
    return queue.poll('asdf', {
      value: 1
    }, 100)
  }).then(function (job) {
    assert.equal(job.output, 5)
  })
})

it('.poll(_id)', function () {
  queue.define('xxxxx', function (input) {
    return input.value * 10
  })

  return queue.dispatch('xxxxx', {
    value: 1
  }).then(function (job) {
    return queue.poll(job._id, 100)
  }).then(function (job) {
    assert.equal(job.output, 10)
  })
})

it('should catch errors', function () {
  queue.define('error', function (input) {
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


it('should support outputs that are arrays', function () {
  queue.define(function (input) {
    return [1, 2, 3]
  })

  return queue.dispatch({
    value: 1
  }).then(function (res) {
    return queue.poll({
      value: 1
    }, 100)
  }).then(function (job) {
    assert.deepEqual(job.output, [1, 2, 3])
  })
})

it('should .get() the latest value', function () {
  return queue.get('asdf', {
    value: 1
  }).then(function (job) {
    assert(job.output)
  })
})

it('.queued() should return the number of queued outputs', function () {
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

it('.getById(_id) a job', function () {
  return queue.getById(job._id).then(function (job2) {
    assert(job2)
    assert(job2._id.equals(job._id))
  })
})

it('should remove jobs if .dispose()', function () {
  var queue = Queue()
  queue.collection = db.collection('test2')
  queue.delay(10)
  queue.run()
  queue.dispose()

  queue.define(function () {
    return true
  })

  return queue.dispatch({
    value: 'asdf'
  }).then(function next() {
    return queue.collection.findOne('input.value', 'asdf')
    .then(function (job) {
      if (job) return new Promise(function (resolve) {
        setTimeout(resolve, 10)
      })
    })
  })
})
