'use strict'
const assert = require('node:assert')
const { test } = require('node:test')
const path = require('node:path')

const { compose } = require('../lib')
const { graphqlRequest, createGraphqlServices, createComposerService } = require('./helper')

test('should use the defaultArgsAdapter provided in options', async (t) => {
  const query = '{ getReviewBook(id: 1) { title } }'
  const expectedResponse = { getReviewBook: { title: 'A Book About Things That Never Happened' } }

  let calls = 0

  const services = await createGraphqlServices(t, [
    {
      name: 'books-subgraph',
      file: path.join(__dirname, 'fixtures/books.js'),
      listen: true
    },
    {
      name: 'reviews-subgraph',
      file: path.join(__dirname, 'fixtures/reviews.js'),
      listen: true
    }
  ])
  const options = {
    defaultArgsAdapter: (partialResults) => {
      calls++
      return { ids: partialResults.map(r => r.bookId) }
    },
    subgraphs: services.map(service => ({
      entities: service.config.entities,
      name: service.name,
      server: { host: service.host }
    }))
  }

  options.subgraphs[0].entities.Book.resolver.argsAdapter = undefined

  const { service } = await createComposerService(t, { compose, options })
  const result = await graphqlRequest(service, query)

  assert.strictEqual(calls, 1)
  assert.deepStrictEqual(result, expectedResponse)
})

test('should use the generic argsAdapter if not provided', async (t) => {
  const query = '{ getReviewBook(id: 1) { title } }'
  const expectedResponse = { getReviewBook: { title: 'A Book About Things That Never Happened' } }

  const services = await createGraphqlServices(t, [
    {
      name: 'books-subgraph',
      file: path.join(__dirname, 'fixtures/books.js'),
      listen: true
    },
    {
      name: 'reviews-subgraph',
      file: path.join(__dirname, 'fixtures/reviews.js'),
      listen: true
    }
  ])
  const options = {
    subgraphs: services.map(service => ({
      entities: service.config.entities,
      name: service.name,
      server: { host: service.host }
    }))
  }

  options.subgraphs[1].entities.Book.resolver.argsAdapter = undefined

  const { service } = await createComposerService(t, { compose, options })
  const result = await graphqlRequest(service, query)

  assert.deepStrictEqual(result, expectedResponse)
})

const cases = [
  {
    name: 'should get error when options is not an object',
    config: 'na',
    expect: {
      name: 'TypeError',
      message: 'options must be an object'
    }
  },
  {
    name: 'should get error when queryTypeName is not a string',
    config: { queryTypeName: -1 },
    expect: {
      name: 'TypeError',
      message: 'queryTypeName must be a string'
    }
  },
  {
    name: 'should get error when subgraphs is not an array',
    config: { subgraphs: 'not-an-array' },
    expect: {
      name: 'TypeError',
      message: 'subgraphs must be an array'
    }
  },
  {
    name: 'should get error when onSubgraphError is not a function',
    config: {
      subgraphs: [{ server: { host: 'http://graph1.local' } }],
      onSubgraphError: 1
    },
    expect: {
      name: 'TypeError',
      message: 'onSubgraphError must be a function'
    }
  },
  {
    name: 'should get error when subgraph entities is not an object',
    config: {
      subgraphs: [
        { server: { host: 'http://graph2.local' }, entities: 'not-an-object' }
      ]
    },
    expect: {
      name: 'TypeError',
      message: 'subgraphs[#0].entities must be an object'
    }
  },
  {
    name: 'should get error when subgraphs names are not unique',
    config: {
      subgraphs: [
        { name: 'dogs', server: { host: 'http://graph1.local' } },
        { name: 'dogs', server: { host: 'http://graph2.local' } }
      ]
    },
    expect: {
      name: 'TypeError',
      message: 'subgraphs name dogs is not unique'
    }
  }
]

for (const c of cases) {
  test(c.name, async t => {
    await assert.rejects(compose(c.config), c.expect)
  })
}
