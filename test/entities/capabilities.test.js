'use strict'

const assert = require('node:assert')
const path = require('node:path')
const { test } = require('node:test')

const { createComposerService, createGraphqlServices, graphqlRequest } = require('../helper')
const { compose } = require('../../lib')

test('resolves a partial entity from a single subgraph', async (t) => {
  const query = `
    query {
      getReviewBook(id: 1) {
        id
        reviews {
          id
          rating
          content
        }
      }
    }
  `
  const expectedResult = {
    getReviewBook: {
      id: '1',
      reviews: [
        {
          id: '1',
          rating: 2,
          content: 'Would not read again.'
        }
      ]
    }
  }

  const services = await createGraphqlServices(t, [
    {
      name: 'books-subgraph',
      file: path.join(__dirname, '../fixtures/books.js'),
      listen: true
    },
    {
      name: 'reviews-subgraph',
      file: path.join(__dirname, '../fixtures/reviews.js'),
      listen: true
    }
  ])

  const options = {
    subgraphs: services.map(service => ({
      name: service.name,
      entities: service.config.entities,
      server: { host: service.host }
    }))
  }

  const { service } = await createComposerService(t, { compose, options })

  const result = await graphqlRequest(service, query)
  assert.deepStrictEqual(result, expectedResult)
})

test('should run the same query with different args', async (t) => {
  const queries = [
    '{ getReviewBookByIds(ids: [1]) { title reviews { rating } } }',
    '{ getReviewBookByIds(ids: [2]) { title reviews { rating } } }'
  ]

  const expectedResults = [{
    getReviewBookByIds: [{
      reviews: [{ rating: 2 }],
      title: 'A Book About Things That Never Happened'
    }]
  },
  {
    getReviewBookByIds: [{
      reviews: [{ rating: 3 }],
      title: 'A Book About Things That Really Happened'
    }]
  }]

  const services = await createGraphqlServices(t, [
    {
      name: 'books-subgraph',
      file: path.join(__dirname, '../fixtures/books.js'),
      listen: true
    },
    {
      name: 'reviews-subgraph',
      file: path.join(__dirname, '../fixtures/reviews.js'),
      listen: true
    }
  ])

  const options = {
    subgraphs: services.map(service => ({
      name: service.name,
      entities: service.config.entities,
      server: { host: service.host }
    }))
  }

  const { service } = await createComposerService(t, { compose, options })

  for (let i = 0; i < queries.length; i++) {
    const result = await graphqlRequest(service, queries[i])
    assert.deepStrictEqual(result, expectedResults[i])
  }
})

test('resolves an entity across multiple subgraphs', async (t) => {
  const cases = [
    {
      name: 'should run a query from non-owner to owner subgraph',
      query: `query {
            getReviewBook(id: 1) {
              id
              title
              genre
              reviews {
                id
                rating
                content
              }
            }
          }`,
      result: {
        getReviewBook: {
          id: '1',
          title: 'A Book About Things That Never Happened',
          genre: 'FICTION',
          reviews: [
            {
              id: '1',
              rating: 2,
              content: 'Would not read again.'
            }
          ]
        }
      }
    },
    {
      name: 'should run a query flows from owner to non-owner subgraph',
      query: `query {
            getBook(id: 1) {
              id
              title
              genre
              reviews {
                id
                rating
                content
              }
            }
          }`,
      result: {
        getBook: {
          id: '1',
          title: 'A Book About Things That Never Happened',
          genre: 'FICTION',
          reviews: [
            {
              id: '1',
              rating: 2,
              content: 'Would not read again.'
            }
          ]
        }
      }
    },
    {
      name: 'should run a fetches key fields not in selection set',
      query: `query {
            getReviewBook(id: 1) {
              # id not included and it is part of the keys.
              title
              genre
              reviews {
                id
                rating
                content
              }
            }
          }`,
      result: {
        getReviewBook: {
          title: 'A Book About Things That Never Happened',
          genre: 'FICTION',
          reviews: [
            {
              id: '1',
              rating: 2,
              content: 'Would not read again.'
            }
          ]
        }
      }
    }
  ]

  let service
  t.before(async () => {
    const services = await createGraphqlServices(t, [
      {
        name: 'books-subgraph',
        file: path.join(__dirname, '../fixtures/books.js'),
        listen: true
      },
      {
        name: 'reviews-subgraph',
        file: path.join(__dirname, '../fixtures/reviews.js'),
        listen: true
      }
    ])
    const options = {
      subgraphs: services.map(service => ({
        name: service.name,
        entities: service.config.entities,
        server: { host: service.host }
      }))
    }

    const s = await createComposerService(t, { compose, options })
    service = s.service
  })

  for (const c of cases) {
    await t.test(c.name, async (t) => {
      const result = await graphqlRequest(service, c.query, c.variables)

      assert.deepStrictEqual(result, c.result)
    })
  }
})
