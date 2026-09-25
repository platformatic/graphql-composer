'use strict'

const assert = require('node:assert')
const { test } = require('node:test')
const dedent = require('dedent')
const { createGraphqlServices, createComposerService, graphqlRequest } = require('./helper')
const { compose } = require('../')

// Two subgraphs publish the same Mutation field with the same enum argument, each declaring its
// own values. How the composer resolves that is the `onConflict` option: "error" (the default)
// refuses, "first" and "last" pick a subgraph, "route" merges the enum and sends each call to the
// subgraph that declares the value the client passed.
function indexingSubgraph (owner, entities, calls, { field = 'reindex(entity: IndexedEntity!): IndexResult!', result = 'type IndexResult { indexed: Int! }' } = {}) {
  const values = entities.map(entity => `"""${owner}""" ${entity}`).join(' ')
  return {
    name: owner,
    mercurius: {
      schema: `
        enum IndexedEntity { ${values} }
        ${result}
        type Query { ${owner}Status: String }
        type Mutation { ${field} }
      `,
      resolvers: {
        Query: { [`${owner}Status`]: () => 'ok' },
        Mutation: {
          reindex: (_, args) => {
            calls.push(args.entity)
            return { indexed: entities.indexOf(args.entity) + 1, count: 0 }
          }
        }
      }
    },
    listen: true
  }
}

async function composeOptions (t, configs, options = {}) {
  const services = await createGraphqlServices(t, configs)
  return {
    ...options,
    subgraphs: services.map(service => ({ name: service.name, server: { host: service.host } }))
  }
}

function collectingLogger (lines) {
  const push = level => (...args) => lines.push({ level, args })
  return { fatal: push('fatal'), error: push('error'), warn: push('warn'), info: push('info'), debug: push('debug'), trace: push('trace'), child () { return this } }
}

async function rawRequest (service, query, variables) {
  const response = await service.inject({
    path: '/graphql',
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ query, variables })
  })
  return response.json()
}

test.describe('onConflict option', () => {
  test('should reject an unknown strategy', async () => {
    await assert.rejects(compose({ onConflict: 'merge' }), /onConflict must be one of "first", "last", "route", "error"/)
  })

  test('should fail to compose a shared root field by default', async (t) => {
    const options = await composeOptions(t, [
      indexingSubgraph('books', ['BOOK'], []),
      indexingSubgraph('reviews', ['REVIEW'], [])
    ])

    await assert.rejects(compose(options),
      /Cannot compose Mutation\.reindex is published by subgraphs books, reviews: set onConflict to "route", "first" or "last" to resolve it/)
  })

  for (const [strategy, winner, values] of [['first', 'books', ['BOOK']], ['last', 'reviews', ['REVIEW', 'AUTHOR']]]) {
    test(`"${strategy}" should let the ${winner} subgraph answer a shared field and keep its enum, with a warning`, async (t) => {
      const calls = { books: [], reviews: [] }
      const lines = []
      const options = await composeOptions(t, [
        indexingSubgraph('books', ['BOOK'], calls.books),
        indexingSubgraph('reviews', ['REVIEW', 'AUTHOR'], calls.reviews)
      ], { onConflict: strategy, logger: collectingLogger(lines) })
      const { composer, service } = await createComposerService(t, { compose, options })

      const sdl = composer.toSdl()
      assert.match(sdl, new RegExp(`enum IndexedEntity \\{\\n(?: {2}"""${winner}"""\\n {2}\\w+\\n\\n?)+\\}`))
      for (const value of values) { assert.match(sdl, new RegExp(`\\n {2}${value}\\n`)) }
      assert.strictEqual(sdl.match(/reindex\(/g).length, 1)

      const warning = lines.find(line => line.level === 'warn')
      assert.match(warning.args[1], new RegExp(`Mutation\\.reindex is published by subgraphs books, reviews: resolved by subgraph ${winner} \\(onConflict: ${strategy}\\)`))

      await graphqlRequest(service, `mutation { reindex(entity: ${values[0]}) { indexed } }`)
      assert.deepStrictEqual(calls[winner], [values[0]])
      assert.deepStrictEqual(calls[winner === 'books' ? 'reviews' : 'books'], [])
    })
  }
})

test.describe('onConflict: "route"', () => {
  const route = { onConflict: 'route' }

  test('should merge a same-named enum as the union of the values and publish shared types once', async (t) => {
    const options = await composeOptions(t, [
      indexingSubgraph('books', ['BOOK'], []),
      indexingSubgraph('reviews', ['REVIEW', 'AUTHOR'], [])
    ], route)

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
    const options = await composeOptions(t, [
      indexingSubgraph('books', ['BOOK'], books),
      indexingSubgraph('reviews', ['REVIEW', 'AUTHOR'], reviews)
    ], route)
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

  test('should route a shared query too', async (t) => {
    const calls = { books: [], reviews: [] }
    const subgraph = (owner, value) => ({
      name: owner,
      mercurius: {
        schema: `enum Kind { ${value} } type Query { count(kind: Kind!): Int }`,
        resolvers: { Query: { count: (_, { kind }) => { calls[owner].push(kind); return kind.length } } }
      },
      listen: true
    })
    const options = await composeOptions(t, [subgraph('books', 'BOOK'), subgraph('reviews', 'REVIEW')], route)
    const { service } = await createComposerService(t, { compose, options })

    assert.deepStrictEqual(await graphqlRequest(service, '{ count(kind: REVIEW) }'), { count: 6 })
    assert.deepStrictEqual(calls, { books: [], reviews: ['REVIEW'] })
  })

  // Each subgraph can only default the routing argument to a value it declares, so the defaults
  // differ by construction. The merged schema keeps the first subgraph's, and a call left to it
  // is routed to that subgraph, which applies the same default itself.
  test('should route by a defaulted argument the client left out', async (t) => {
    const books = []
    const reviews = []
    const options = await composeOptions(t, [
      indexingSubgraph('books', ['BOOK'], books, { field: 'reindex(entity: IndexedEntity = BOOK): IndexResult!' }),
      indexingSubgraph('reviews', ['REVIEW'], reviews, { field: 'reindex(entity: IndexedEntity = REVIEW): IndexResult!' })
    ], route)
    const { composer, service } = await createComposerService(t, { compose, options })

    assert.match(composer.toSdl(), /reindex\(entity: IndexedEntity = BOOK\): IndexResult!/)
    assert.deepStrictEqual(await graphqlRequest(service, 'mutation { reindex { indexed } }'), { reindex: { indexed: 1 } })
    assert.deepStrictEqual(await graphqlRequest(service, 'mutation { reindex(entity: REVIEW) { indexed } }'), { reindex: { indexed: 1 } })
    assert.deepStrictEqual({ books, reviews }, { books: ['BOOK'], reviews: ['REVIEW'] })
  })

  test('should fail to compose when the subgraphs disagree on the default of another argument', async (t) => {
    const options = await composeOptions(t, [
      indexingSubgraph('books', ['BOOK'], [], { field: 'reindex(entity: IndexedEntity!, force: Boolean = true): IndexResult!' }),
      indexingSubgraph('reviews', ['REVIEW'], [], { field: 'reindex(entity: IndexedEntity!, force: Boolean = false): IndexResult!' })
    ], route)

    await assert.rejects(compose(options),
      /Cannot compose Mutation\.reindex .* the argument defaults differ \(books: \(force = true\); reviews: \(force = false\)\)/)
  })

  test('should reject a value no subgraph declares before reaching any subgraph', async (t) => {
    const books = []
    const reviews = []
    const options = await composeOptions(t, [
      indexingSubgraph('books', ['BOOK'], books),
      indexingSubgraph('reviews', ['REVIEW'], reviews)
    ], route)
    const { service } = await createComposerService(t, { compose, options })

    const { data, errors } = await rawRequest(service, 'mutation { reindex(entity: PUBLISHER) { indexed } }')

    assert.strictEqual(data, null)
    assert.match(errors[0].message, /"PUBLISHER" does not exist in "IndexedEntity" enum/)
    assert.deepStrictEqual({ books, reviews }, { books: [], reviews: [] })
  })

  test('should merge a same-named enum of non-shared fields as the union too', async (t) => {
    const subgraph = (owner, values) => ({
      name: owner,
      mercurius: {
        schema: `enum Sort { ${values} } type Query { ${owner}List(sort: Sort): [String] }`,
        resolvers: { Query: { [`${owner}List`]: (_, { sort }) => [sort] } }
      },
      listen: true
    })
    const options = await composeOptions(t, [subgraph('books', 'ASC DESC'), subgraph('reviews', 'ASC DESC RANDOM')], route)
    const composer = await compose(options)

    assert.match(composer.toSdl(), /enum Sort \{\n {2}ASC\n {2}DESC\n {2}RANDOM\n\}/)
  })

  test('should fail to compose when two subgraphs declare the same enum value', async (t) => {
    const options = await composeOptions(t, [
      indexingSubgraph('books', ['BOOK'], []),
      indexingSubgraph('catalog', ['SERIES', 'BOOK'], [])
    ], route)

    await assert.rejects(compose(options),
      /Cannot compose Mutation\.reindex is published by subgraphs books, catalog: no enum argument with a distinct set of values per subgraph to route by/)
  })

  test('should fail to compose a shared root field with no enum argument to route by', async (t) => {
    const status = owner => ({
      name: owner,
      mercurius: {
        schema: 'type Query { status: String }',
        resolvers: { Query: { status: () => owner } }
      },
      listen: true
    })
    const options = await composeOptions(t, [status('books'), status('reviews')], route)

    await assert.rejects(compose(options),
      /Cannot compose Query\.status is published by subgraphs books, reviews: no enum argument/)
  })

  test('should fail to compose when the only enum argument is nullable without a default', async (t) => {
    const field = 'reindex(entity: IndexedEntity): IndexResult!'
    const options = await composeOptions(t, [
      indexingSubgraph('books', ['BOOK'], [], { field }),
      indexingSubgraph('reviews', ['REVIEW'], [], { field })
    ], route)

    await assert.rejects(compose(options),
      /Cannot compose Mutation\.reindex .*"entity" is a nullable enum argument without a default value, declare it as non-null or give it a default/)
  })

  test('should not route by a list of enums', async (t) => {
    const field = 'reindex(entity: [IndexedEntity!]!): IndexResult!'
    const options = await composeOptions(t, [
      indexingSubgraph('books', ['BOOK'], [], { field }),
      indexingSubgraph('reviews', ['REVIEW'], [], { field })
    ], route)

    await assert.rejects(compose(options), /Cannot compose Mutation\.reindex .*no enum argument/)
  })

  test('should fail to compose when more than one enum argument could route a shared field', async (t) => {
    const lookup = (owner, kind, region) => ({
      name: owner,
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
    const options = await composeOptions(t, [lookup('one', 'A', 'EU'), lookup('two', 'B', 'US')], route)

    await assert.rejects(compose(options),
      /Cannot compose Query\.lookup .* more than one enum argument could route it \(kind, region\)/)
  })

  test('should fail to compose when the subgraphs disagree on the return type', async (t) => {
    const options = await composeOptions(t, [
      indexingSubgraph('books', ['BOOK'], []),
      indexingSubgraph('reviews', ['REVIEW'], [], { field: 'reindex(entity: IndexedEntity!): IndexCount!', result: 'type IndexCount { count: Int! }' })
    ], route)

    await assert.rejects(compose(options),
      /Cannot compose Mutation\.reindex .* the signatures differ \(books: \(entity: IndexedEntity!\): IndexResult!; reviews: \(entity: IndexedEntity!\): IndexCount!\)/)
  })

  test('should fail to compose when one subgraph declares an extra argument', async (t) => {
    const options = await composeOptions(t, [
      indexingSubgraph('books', ['BOOK'], [], { field: 'reindex(entity: IndexedEntity!, force: Boolean): IndexResult!' }),
      indexingSubgraph('reviews', ['REVIEW'], [])
    ], route)

    await assert.rejects(compose(options), /the signatures differ \(books: \(entity: IndexedEntity!, force: Boolean\): IndexResult!; reviews: \(entity: IndexedEntity!\): IndexResult!\)/)
  })

  test('should fail to compose when the subgraphs disagree on the nullability of the routing argument', async (t) => {
    const options = await composeOptions(t, [
      indexingSubgraph('books', ['BOOK'], []),
      indexingSubgraph('reviews', ['REVIEW'], [], { field: 'reindex(entity: IndexedEntity = REVIEW): IndexResult!' })
    ], route)

    await assert.rejects(compose(options), /the signatures differ/)
  })

  test('should fail to compose when a subgraph that does not publish the field adds values to the enum', async (t) => {
    const stats = {
      name: 'stats',
      mercurius: {
        schema: 'enum IndexedEntity { COMMENT } type Query { statsCount(entity: IndexedEntity!): Int }',
        resolvers: { Query: { statsCount: () => 0 } }
      },
      listen: true
    }
    const options = await composeOptions(t, [
      indexingSubgraph('books', ['BOOK'], []),
      indexingSubgraph('reviews', ['REVIEW'], []),
      stats
    ], route)

    await assert.rejects(compose(options),
      /Cannot compose Mutation\.reindex .* enum IndexedEntity has values declared by subgraphs that do not publish the field, COMMENT \(stats\)/)
  })
})

test.describe('same-named object types', () => {
  const pizza = (owner, id, extra) => ({
    name: owner,
    mercurius: {
      schema: `type Pizza { id: ${id} ${extra} } type Query { ${owner}Pizza: Pizza }`,
      resolvers: { Query: { [`${owner}Pizza`]: () => null } }
    },
    listen: true
  })

  for (const [strategy, id] of [['first', 'ID'], ['route', 'ID'], ['error', 'ID'], ['last', 'Int!']]) {
    test(`should publish each field once, the ${strategy === 'last' ? 'last' : 'first'} declaration of a shared one under "${strategy}"`, async (t) => {
      const options = await composeOptions(t, [pizza('a', 'ID', 'name: String'), pizza('b', 'Int!', 'size: Int')], { onConflict: strategy })
      const composer = await compose(options)

      assert.match(composer.toSdl(), new RegExp(`type Pizza \\{\\n {2}id: ${id.replace('!', '\\!')}\\n {2}name: String\\n {2}size: Int\\n\\}`))
    })
  }
})
