
# mkue

[![NPM version][npm-image]][npm-url]
[![Build status][travis-image]][travis-url]
[![Test coverage][coveralls-image]][coveralls-url]
[![Dependency Status][david-image]][david-url]
[![License][license-image]][license-url]
[![Downloads][downloads-image]][downloads-url]
[![Gittip][gittip-image]][gittip-url]

A MongoDB-backed job queueing mechanism.

- Concurrency handling
- Throttling inputs
- Persistence of all input/output
- FIFO
- Exits the process gracefully

## Example

Dispatcher:

```js
var Queue = require('mkue');

var queue = new Queue();
// set a db
queue.collection = db.collection('stuff');
// make sure indexes are set
queue.ensureIndexes();

queue.dispatch('this function', {
  these: 'inputs'
})
```

Worker:

```js
var Queue = require('mkue');

var queue = new Queue();
// set a db
queue.collection = db.collection('stuff');
// make sure indexes are set
queue.ensureIndexes();

// define a namespaced function
queue.define('this function', function (options) {
  return new Promise(function (resolve) {
    resolve(options.these);
  });
});

// set the concurrency
queue.concurrency(5);

// start listening
queue.run();
```

## API

### var queue = new Queue([options])

The options are:

- `concurrency <1>` - number of jobs to be processed in parallel in this process
- `delay <1000>` - delay to query the next batch of jobs on drain
- `collection` - the MongoDB collection for this queue

### queue.collection =

You are required to set the collection for this worker queue manually.

### queue.concurrency(count <Integer>)

Set the maximum number of concurrent, local jobs.

### queue.delay(ms <Integer> | <String>)

Set the delay after draining the queue to start looking for jobs again.

### queue.ensureIndexes().then( => )

Set the indexes for queues and currently processing jobs.
Assumes that the queue is always short.

### queue.processing().then( count => )

Get the current number of jobs being processed.

### queue.queued().then( count => )

Get the current number of jobs in the queue.

### queue.queue([ms <Integer> | <String>])

Waits `ms` to start a new job.

### queue.dispatch([name <String>], fn <Function>).then( job => )

Add a job to the queue.

### queue.get([name <String>], options <Object>).then( job => )

Get the latest job with `name` and `options`.
May or may not be completed yet.

### queue.getById(<ObjectId>).then( job => )

Get a job by its ID.

### queue.poll([name <String>], options <Object>, [ms <Integer> | <String>]).then( job => )

Poll the latest job at interval `ms` with `name` and `options` until it's complete.

### queue.define([name <String>], fn <Function>)

Define a function.
`name` defaults to `'default'` if not set.
`fn`'s API should be:

```js
fn([options]).then( result => )
```

You only need to define this on a worker process.

### queue.run()

Start running a new job.
Call this on a worker process.

### queue.close()

Stop creating new jobs.

[gitter-image]: https://badges.gitter.im/mongodb-utils/mkue.png
[gitter-url]: https://gitter.im/mongodb-utils/mkue
[npm-image]: https://img.shields.io/npm/v/mkue.svg?style=flat-square
[npm-url]: https://npmjs.org/package/mkue
[github-tag]: http://img.shields.io/github/tag/mongodb-utils/mkue.svg?style=flat-square
[github-url]: https://github.com/mongodb-utils/mkue/tags
[travis-image]: https://img.shields.io/travis/mongodb-utils/mkue.svg?style=flat-square
[travis-url]: https://travis-ci.org/mongodb-utils/mkue
[coveralls-image]: https://img.shields.io/coveralls/mongodb-utils/mkue.svg?style=flat-square
[coveralls-url]: https://coveralls.io/r/mongodb-utils/mkue
[david-image]: http://img.shields.io/david/mongodb-utils/mkue.svg?style=flat-square
[david-url]: https://david-dm.org/mongodb-utils/mkue
[license-image]: http://img.shields.io/npm/l/mkue.svg?style=flat-square
[license-url]: LICENSE
[downloads-image]: http://img.shields.io/npm/dm/mkue.svg?style=flat-square
[downloads-url]: https://npmjs.org/package/mkue
[gittip-image]: https://img.shields.io/gratipay/jonathanong.svg?style=flat-square
[gittip-url]: https://gratipay.com/jonathanong/
