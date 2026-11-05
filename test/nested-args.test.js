'use strict'

const assert = require('node:assert')
const { test } = require('node:test')

const {
  createComposerService,
  createGraphqlServices,
  graphqlRequest
} = require('./helper')
const { compose } = require('../lib')

const artists = [
  { id: '101', name: 'Nolan' },
  { id: '102', name: 'Benigni' },
  { id: '201', name: 'Pavarotti' }
]

const tags = [
  { id: '1', artistId: '101', tag: 'visual', score: 3 },
  { id: '2', artistId: '102', tag: 'visual', score: 1 },
  { id: '3', artistId: '101', tag: 'sound', score: 2 }
]

const schema = `
  enum OrderDirection { ASC DESC }

  input IdCondition { eq: ID, in: [ID] }
  input TagsWhere { id: IdCondition, tag: String }
  input TagsOrderBy { field: String!, direction: OrderDirection! }

  type Tag { id: ID! tag: String! }
  type Artist { id: ID! name: String! tags(where: TagsWhere, orderBy: [TagsOrderBy], limit: Int): [Tag] }

  type Query { artists: [Artist] }
`

function matches (tag, where) {
  if (!where) { return true }
  if (where.id?.eq !== undefined && tag.id !== where.id.eq) { return false }
  if (where.id?.in !== undefined && !where.id.in.includes(tag.id)) { return false }
  if (where.tag !== undefined && tag.tag !== where.tag) { return false }
  return true
}

const resolvers = {
  Query: {
    artists: () => artists
  },
  Artist: {
    tags: (artist, { where, orderBy, limit }) => {
      let result = tags.filter(t => t.artistId === artist.id && matches(t, where))
      for (const { field, direction } of orderBy ?? []) {
        const sign = direction === 'ASC' ? 1 : -1
        result = result.toSorted((a, b) => sign * (a[field] - b[field]))
      }
      return limit === undefined ? result : result.slice(0, limit)
    }
  }
}

async function setup (t) {
  const services = await createGraphqlServices(t, [{
    name: 'artists-subgraph',
    mercurius: { schema, resolvers },
    listen: true
  }])

  const options = {
    subgraphs: services.map(service => ({
      name: service.name,
      server: { host: service.host }
    }))
  }

  const { service } = await createComposerService(t, { compose, options })
  return service
}

test('should pass an object argument of a nested field to the subgraph', async (t) => {
  const service = await setup(t)

  const query = '{ artists { id tags(where: { id: { eq: "1" } }) { id } } }'
  const result = await graphqlRequest(service, query)

  assert.deepStrictEqual(result, {
    artists: [
      { id: '101', tags: [{ id: '1' }] },
      { id: '102', tags: [] },
      { id: '201', tags: [] }
    ]
  })
})

test('should pass list, enum and int arguments of a nested field to the subgraph', async (t) => {
  const service = await setup(t)

  const query = `{
    artists {
      id
      tags(where: { id: { in: ["1", "2", "3"] } }, orderBy: [{ field: "score", direction: ASC }], limit: 1) { id }
    }
  }`
  const result = await graphqlRequest(service, query)

  assert.deepStrictEqual(result, {
    artists: [
      { id: '101', tags: [{ id: '3' }] },
      { id: '102', tags: [{ id: '2' }] },
      { id: '201', tags: [] }
    ]
  })
})

test('should pass variables inside an object argument of a nested field to the subgraph', async (t) => {
  const service = await setup(t)

  const query = `query ($id: ID, $tag: String) {
    artists { id tags(where: { id: { eq: $id }, tag: $tag }) { id } }
  }`
  const result = await graphqlRequest(service, query, { id: '3', tag: 'sound' })

  assert.deepStrictEqual(result, {
    artists: [
      { id: '101', tags: [{ id: '3' }] },
      { id: '102', tags: [] },
      { id: '201', tags: [] }
    ]
  })
})

test('should pass an object variable as argument of a nested field to the subgraph', async (t) => {
  const service = await setup(t)

  const query = `query ($where: TagsWhere) {
    artists { id tags(where: $where) { id } }
  }`
  const result = await graphqlRequest(service, query, { where: { tag: 'visual' } })

  assert.deepStrictEqual(result, {
    artists: [
      { id: '101', tags: [{ id: '1' }] },
      { id: '102', tags: [{ id: '2' }] },
      { id: '201', tags: [] }
    ]
  })
})
