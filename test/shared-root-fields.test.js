'use strict'

const assert = require('node:assert')
const { test } = require('node:test')
const dedent = require('dedent')
const { createGraphqlServices, createComposerService, graphqlRequest } = require('./helper')
const { compose } = require('../')

// Two subgraphs publish the same Mutation field with the same enum argument, each declaring
// its own values: the merged enum is the union, the field appears once, and a call is routed
// to the subgraph that declares the value the client passed.
function indexingSubgraph (entities, owner, calls) {
  const values = entities.map(entity => `"""${owner}""" ${entity}`).join(' ')
  return {
    mercurius: {
      schema: `
        enum IndexedEntity { ${values} }
        type IndexResult { indexed: Int! }
        type Query { ${owner}Status: String }
        type Mutation { reindex(entity: IndexedEntity!): IndexResult! }
      `,
      resolvers: {
        Query: { [`${owner}Status`]: () => 'ok' },
        Mutation: {
          reindex: (_, { entity }) => {
            calls.push(entity)
            return { indexed: entities.indexOf(entity) + 1 }
          }
        }
      }
    },
    listen: true
  }
}

async function composeServices (t, configs) {
  const services = await createGraphqlServices(t, configs)
  const options = {
    subgraphs: services.map(service => ({ name: service.name, server: { host: service.host } }))
  }
  return { services, options }
}

test.describe('same-named root fields across subgraphs', () => {
  test('should merge a same-named enum as the union of the values and publish shared types once', async (t) => {
    const { options } = await composeServices(t, [
      { name: 'books', ...indexingSubgraph(['BOOK'], 'books', []) },
      { name: 'reviews', ...indexingSubgraph(['REVIEW', 'AUTHOR'], 'reviews', []) }
    ])

    const composer = await compose(options)

    assert.strictEqual(composer.toSdl(), dedent`
      enum IndexedEntity {
        """books"""
        BOOK

        """reviews"""
        REVIEW

        """reviews"""
        AUTHOR
      }

      type IndexResult {
        indexed: Int!
      }

      type Query {
        booksStatus: String
        reviewsStatus: String
      }

      type Mutation {
        reindex(entity: IndexedEntity!): IndexResult!
      }`)
  })

  test('should route a shared mutation to the subgraph that declares the enum value', async (t) => {
    const books = []
    const reviews = []
    const { options } = await composeServices(t, [
      { name: 'books', ...indexingSubgraph(['BOOK'], 'books', books) },
      { name: 'reviews', ...indexingSubgraph(['REVIEW', 'AUTHOR'], 'reviews', reviews) }
    ])
    const { service } = await createComposerService(t, { compose, options })

    const literal = await graphqlRequest(service, 'mutation { reindex(entity: AUTHOR) { indexed } }')
    assert.deepStrictEqual(literal, { reindex: { indexed: 2 } })

    const variable = await graphqlRequest(service,
      'mutation ($entity: IndexedEntity!) { reindex(entity: $entity) { indexed } }',
      { entity: 'BOOK' })
    assert.deepStrictEqual(variable, { reindex: { indexed: 1 } })

    assert.deepStrictEqual({ books, reviews }, { books: ['BOOK'], reviews: ['AUTHOR'] })

    // fields published by one subgraph only are untouched
    const own = await graphqlRequest(service, '{ booksStatus reviewsStatus }')
    assert.deepStrictEqual(own, { booksStatus: 'ok', reviewsStatus: 'ok' })
  })

  test('should reject a value no subgraph declares before reaching any subgraph', async (t) => {
    const books = []
    const reviews = []
    const { options } = await composeServices(t, [
      { name: 'books', ...indexingSubgraph(['BOOK'], 'books', books) },
      { name: 'reviews', ...indexingSubgraph(['REVIEW'], 'reviews', reviews) }
    ])
    const { service } = await createComposerService(t, { compose, options })

    const response = await service.inject({
      path: '/graphql',
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query: 'mutation { reindex(entity: PUBLISHER) { indexed } }' })
    })
    const { data, errors } = response.json()

    assert.strictEqual(data, null)
    assert.match(errors[0].message, /"PUBLISHER" does not exist in "IndexedEntity" enum/)
    assert.deepStrictEqual({ books, reviews }, { books: [], reviews: [] })
  })

  test('should fail to compose when two subgraphs declare the same enum value', async (t) => {
    const { options } = await composeServices(t, [
      { name: 'books', ...indexingSubgraph(['BOOK'], 'books', []) },
      { name: 'catalog', ...indexingSubgraph(['SERIES', 'BOOK'], 'catalog', []) }
    ])

    await assert.rejects(compose(options),
      /Cannot compose Mutation\.reindex is published by subgraphs books, catalog: no enum argument with a distinct set of values per subgraph to route by/)
  })

  test('should fail to compose a shared root field with no enum argument to route by', async (t) => {
    const status = label => ({
      mercurius: {
        schema: 'type Query { status: String }',
        resolvers: { Query: { status: () => label } }
      },
      listen: true
    })
    const { options } = await composeServices(t, [
      { name: 'books', ...status('books') },
      { name: 'reviews', ...status('reviews') }
    ])

    await assert.rejects(compose(options),
      /Cannot compose Query\.status is published by subgraphs books, reviews: no enum argument/)
  })

  test('should fail to compose when more than one enum argument could route a shared field', async (t) => {
    const lookup = (kind, region) => ({
      mercurius: {
        schema: `
          enum Kind { ${kind} }
          enum Region { ${region} }
          type Query { lookup(kind: Kind!, region: Region!): String }
        `,
        resolvers: { Query: { lookup: () => `${kind}/${region}` } }
      },
      listen: true
    })
    const { options } = await composeServices(t, [
      { name: 'one', ...lookup('A', 'EU') },
      { name: 'two', ...lookup('B', 'US') }
    ])

    await assert.rejects(compose(options),
      /Cannot compose Query\.lookup .* more than one enum argument could route it \(kind, region\)/)
  })
})
