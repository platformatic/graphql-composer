'use strict'

const assert = require('node:assert')
const path = require('node:path')
const { test } = require('node:test')

const {
  createComposerService,
  createGraphqlServices,
  graphqlRequest
} = require('./helper')
const { compose } = require('../lib')

test('should run a query to a single subgraph', async (t) => {
  const query =
    '{ artists (where: { id: { in: ["103","102"] } }) { lastName } }'
  const expectedResult = {
    artists: [{ lastName: 'Benigni' }, { lastName: 'Molko' }]
  }

  const services = await createGraphqlServices(t, [
    {
      name: 'artists-subgraph',
      file: path.join(__dirname, 'fixtures/artists.js'),
      listen: true
    }
  ])
  const options = {
    subgraphs: services.map((service) => ({
      name: service.name,
      server: { host: service.host }
    }))
  }

  const { service } = await createComposerService(t, { compose, options })
  const result = await graphqlRequest(service, query)

  assert.deepStrictEqual(result, expectedResult)
})

test('should run a query to a single subgraph, with a nested type', async (t) => {
  const query = `
    query {
      list {
        id name { firstName lastName }
      }
    }
  `
  const expectedResult = {
    list: [
      { id: '1', name: { firstName: 'Peter', lastName: 'Pluck' } },
      { id: '2', name: { firstName: 'John', lastName: 'Writer' } }
    ]
  }

  const services = await createGraphqlServices(t, [
    {
      name: 'authors-subgraph',
      file: path.join(__dirname, 'fixtures/authors.js'),
      listen: true
    }
  ])
  const options = {
    subgraphs: services.map((service) => ({
      name: service.name,
      server: { host: service.host }
    }))
  }

  const { service } = await createComposerService(t, { compose, options })
  const result = await graphqlRequest(service, query)

  assert.deepStrictEqual(result, expectedResult)
})

test('should run a query with single result on multiple subgraphs', async (t) => {
  const query = '{ getBook(id: 1) { id, title, genre, rate } }'
  const expectedResult = {
    getBook: {
      id: '1',
      title: 'A Book About Things That Never Happened',
      genre: 'FICTION',
      rate: 3
    }
  }

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
    subgraphs: services.map((service) => ({
      entities: service.config.entities,
      name: service.name,
      server: { host: service.host }
    }))
  }

  const { service } = await createComposerService(t, { compose, options })
  const result = await graphqlRequest(service, query)

  assert.deepStrictEqual(result, expectedResult)
})

test('should run a query with list result on multiple subgraphs', async (t) => {
  const query = '{ getBooksByIds(ids: [1,2,3]) { id, title, rate } }'
  const expectedResult = {
    getBooksByIds: [
      {
        id: '1',
        rate: 3,
        title: 'A Book About Things That Never Happened'
      },
      {
        id: '2',
        rate: 4,
        title: 'A Book About Things That Really Happened'
      }
    ]
  }

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
    subgraphs: services.map((service) => ({
      entities: service.config.entities,
      name: service.name,
      server: { host: service.host }
    }))
  }

  const { service } = await createComposerService(t, { compose, options })
  const result = await graphqlRequest(service, query)

  assert.deepStrictEqual(result, expectedResult)
})

test('should run a query that has nulls in results', async (t) => {
  const query = `{
        getReviewBookByIds(ids: [99,1,101,2]) {
          title
          reviews { rating }
        }
      }`

  const expectedResult = {
    getReviewBookByIds: [
      {
        reviews: [{ rating: 2 }],
        title: 'A Book About Things That Never Happened'
      },
      {
        reviews: [{ rating: 3 }],
        title: 'A Book About Things That Really Happened'
      }
    ]
  }

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
    subgraphs: services.map((service) => ({
      entities: service.config.entities,
      name: service.name,
      server: { host: service.host }
    }))
  }

  const { service } = await createComposerService(t, { compose, options })
  const result = await graphqlRequest(service, query)

  assert.deepStrictEqual(result, expectedResult)
})

test('should run a query that has null results', async (t) => {
  const query =
    '{ getReviewBookByIds(ids: [-1,-2,-3]) { title reviews { rating } } }'

  const expectedResult = {
    getReviewBookByIds: []
  }

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
    subgraphs: services.map((service) => ({
      entities: service.config.entities,
      name: service.name,
      server: { host: service.host }
    }))
  }

  const { service } = await createComposerService(t, { compose, options })
  const result = await graphqlRequest(service, query)

  assert.deepStrictEqual(result, expectedResult)
})

test('should run a query with headers', async (t) => {
  const headers = { test: '123' }

  const query = `
    query {
      test
    }
  `
  const expectedResult = {
    test: '123'
  }

  const services = await createGraphqlServices(t, [
    {
      mercurius: {
        schema: 'type Query {\n  test: String\n}',
        resolvers: {
          Query: {
            test: (
              _,
              __,
              {
                reply: {
                  request: {
                    headers: { test }
                  }
                }
              }
            ) => test
          }
        }
      },
      exposeIntrospection: false,
      listen: true
    }
  ])
  const options = {
    subgraphs: services.map((service) => ({
      server: { host: service.host }
    }))
  }

  const { service } = await createComposerService(t, { compose, options })
  const result = await graphqlRequest(service, query, undefined, headers)

  assert.deepStrictEqual(result, expectedResult)
})

test('query capabilities', async (t) => {
  const capabilities = [
    {
      name: 'should run a query with different types in arguments',
      query:
        'query { getBooks(limit: 1, orderBy: [{ field: genre, direction: DESC }]) { title } }',
      result: {
        getBooks: [{ title: 'A Book About Things That Never Happened' }]
      }
    },
    {
      name: 'should run a query with a literal argument',
      query: 'query { getBook(id: 1) { id genre } }',
      result: { getBook: { id: '1', genre: 'FICTION' } }
    },
    {
      name: 'should run a query with a variable argument',
      query: 'query GetBookById($id: ID!) { getBook(id: $id) { id genre } }',
      variables: { id: 2 },
      result: { getBook: { id: '2', genre: 'NONFICTION' } }
    },
    {
      name: 'should run a query with aliases',
      query: 'query { aliasedGetBook: getBook(id: 1) { id genre } }',
      result: { aliasedGetBook: { id: '1', genre: 'FICTION' } }
    },
    {
      name: 'should run a query returning a scalar type',
      query: 'query { getBookTitle (id: 1) }',
      result: { getBookTitle: 'A Book About Things That Never Happened' }
    },
    {
      name: 'should run a query with meta fields',
      query: '{ getBook(id: 1) { __typename ...on Book { id, genre } } }',
      result: { getBook: { __typename: 'Book', id: '1', genre: 'FICTION' } }
    },
    {
      name: 'should run a query with a fragment',
      query: `fragment bookFields on Book { id title genre }
        query GetBookById($id: ID!) { getBook(id: $id) { ...bookFields } }`,
      variables: { id: 1 },
      result: {
        getBook: {
          id: '1',
          genre: 'FICTION',
          title: 'A Book About Things That Never Happened'
        }
      }
    },
    {
      name: 'should run a query with a literal argument',
      query:
        'query { list { id name { firstName lastName } todos (id: 2) { task } } }',
      result: {
        list: [
          {
            id: '1',
            name: { firstName: 'Peter', lastName: 'Pluck' },
            todos: [{ task: 'Get really creative' }]
          },
          {
            id: '2',
            name: { firstName: 'John', lastName: 'Writer' },
            todos: [{ task: 'Get really creative' }]
          }
        ]
      }
    },
    {
      name: 'should run a query query with a variable argument',
      query:
        'query GetAuthorListWithTodos ($id: ID!) { list { id name { firstName lastName } todos(id: $id) { task } } }',
      variables: { id: 1 },
      result: {
        list: [
          {
            id: '1',
            name: { firstName: 'Peter', lastName: 'Pluck' },
            todos: [{ task: 'Write another book' }]
          },
          {
            id: '2',
            name: { firstName: 'John', lastName: 'Writer' },
            todos: [{ task: 'Write another book' }]
          }
        ]
      }
    },
    {
      name: 'should run multiple queries in a single request',
      query: `query {
        getBook(id: 2) { id genre }
        list { id name { firstName lastName } }
      }`,
      result: {
        getBook: { id: '2', genre: 'NONFICTION' },
        list: [
          { id: '1', name: { firstName: 'Peter', lastName: 'Pluck' } },
          { id: '2', name: { firstName: 'John', lastName: 'Writer' } }
        ]
      }
    }
  ]

  let service
  t.before(async () => {
    const services = await createGraphqlServices(t, [
      {
        name: 'books-subgraph',
        file: path.join(__dirname, 'fixtures/books.js'),
        listen: true
      },
      {
        name: 'authors-subgraph',
        file: path.join(__dirname, 'fixtures/authors.js'),
        listen: true
      }
    ])
    const options = {
      subgraphs: services.map((service) => ({
        name: service.name,
        server: { host: service.host }
      }))
    }

    const s = await createComposerService(t, { compose, options })
    service = s.service
  })

  for (const c of capabilities) {
    await t.test(c.name, async (t) => {
      const result = await graphqlRequest(service, c.query, c.variables)

      assert.deepStrictEqual(result, c.result)
    })
  }
})

test('mutations', async (t) => {
  const mutations = [
    {
      name: 'should run a mutation query with variables',
      query: `
      mutation CreateAuthor($author: AuthorInput!) {
        createAuthor(author: $author) {
          id name { firstName lastName }
        }
      }
      `,
      variables: { author: { firstName: 'John', lastName: 'Johnson' } },
      result: {
        createAuthor: {
          id: '3',
          name: { firstName: 'John', lastName: 'Johnson' }
        }
      }
    },

    {
      name: 'should run a mutation query with nested variables',
      query: `
      mutation CreateAuthor($author: AuthorInput!) {
        createAuthor(author: $author) {
          id name { firstName lastName }
        }
      }
      `,
      variables: {
        author: {
          firstName: 'John',
          lastName: 'Johnson',
          address: {
            street: 'Johnson Street 5',
            city: 'Johnson City',
            zip: 4200,
            country: 'US',
            mainResidence: true
          },
          todos: [
            { task: 'Write another book' },
            { task: 'Get really creative' }
          ]
        }
      },
      result: {
        createAuthor: {
          id: '3',
          name: { firstName: 'John', lastName: 'Johnson' }
        }
      }
    },

    {
      name: 'should run a mutation query with nested variables including null values',
      query: `
      mutation CreateAuthor($author: AuthorInput!) {
        createAuthor(author: $author) {
          id name { firstName lastName }
        }
      }
      `,
      variables: {
        author: {
          firstName: 'John',
          lastName: 'Johnson',
          address: null,
          todos: []
        }
      },
      result: {
        createAuthor: {
          id: '3',
          name: { firstName: 'John', lastName: 'Johnson' }
        }
      }
    },

    {
      name: 'should run a mutation query with input object literal',
      query: `
      mutation {
        createAuthor(author: { firstName: "Tuco", lastName: "Gustavo" }) {
          id name { firstName lastName }
        }
      }
      `,
      result: {
        createAuthor: {
          id: '3',
          name: { firstName: 'Tuco', lastName: 'Gustavo' }
        }
      }
    },

    {
      name: 'should run a mutation query with an array as input',
      query: `
      mutation {
        batchCreateAuthor(authors: [
          { firstName: "Ernesto", lastName: "de la Cruz" },
          { firstName: "Hector", lastName: "Rivera" },
        ]) {
          id name { firstName lastName }
        }
      }
      `,
      result: {
        batchCreateAuthor: [
          {
            id: '3',
            name: { firstName: 'Ernesto', lastName: 'de la Cruz' }
          },
          {
            id: '4',
            name: { firstName: 'Hector', lastName: 'Rivera' }
          }
        ]
      }
    },

    {
      name: 'should run a mutation query with an array as input variable',
      query: `
      mutation BatchCreateAuthor($authors: [AuthorInput]!) {
        batchCreateAuthor(authors: $authors) {
          id name { firstName lastName }
        }
      }
      `,
      variables: {
        authors: [
          { firstName: 'Ernesto', lastName: 'de la Cruz' },
          { firstName: 'Hector', lastName: 'Rivera' }
        ]
      },
      result: {
        batchCreateAuthor: [
          {
            id: '3',
            name: { firstName: 'Ernesto', lastName: 'de la Cruz' }
          },
          {
            id: '4',
            name: { firstName: 'Hector', lastName: 'Rivera' }
          }
        ]
      }
    },

    {
      name: 'should run a mutation query with union type response',
      query: `
      mutation UpdateAuthorAddress($authorId: ID!, $address: AuthorAddressInput!) {
        updateAuthorAddress(authorId: $authorId, address: $address) {
          __typename
          ...on Author {
            id name { firstName lastName }
          }
          ... on NotFoundError {
            message
          }
        }
      }
      `,
      variables: {
        authorId: '1',
        address: {
          street: 'Johnson Street 5',
          city: 'Johnson City',
          zip: 4200,
          country: 'US',
          mainResidence: true
        }
      },
      result: {
        updateAuthorAddress: {
          __typename: 'Author',
          id: '1',
          name: { firstName: 'Peter', lastName: 'Pluck' }
        }
      }
    },
    {
      name: 'should run a mutation query with union type response and return NotFoundError',
      query: `
      mutation UpdateAuthorAddress($authorId: ID!, $address: AuthorAddressInput!) {
        updateAuthorAddress(authorId: $authorId, address: $address) {
          __typename
          ... on Author {
            id name { firstName lastName }
          }
          ... on NotFoundError {
            message
          }
        }
      }
      `,
      variables: {
        authorId: '99',
        address: {
          street: 'Johnson Street 5',
          city: 'Johnson City',
          zip: 4200,
          country: 'US',
          mainResidence: true
        }
      },
      result: {
        updateAuthorAddress: {
          __typename: 'NotFoundError',
          message: 'Author not found'
        }
      }
    },

    {
      name: 'should run a mutation query with fragment',
      query: `
      fragment authorFields on Author {
        id name { firstName lastName }
      }
      mutation UpdateAuthorAddress($authorId: ID!, $address: AuthorAddressInput!) {
        updateAuthorAddress(authorId: $authorId, address: $address) {
          __typename
          ...authorFields
          ... on NotFoundError {
            message
          }
        }
      }
      `,
      variables: {
        authorId: '99',
        address: {
          street: 'Johnson Street 5',
          city: 'Johnson City',
          zip: 4200,
          country: 'US',
          mainResidence: true
        }
      },
      result: {
        updateAuthorAddress: {
          __typename: 'NotFoundError',
          message: 'Author not found'
        }
      }
    },

    {
      name: 'should run a query with multiple nested selections at the same level',
      query: `{
    getBook(id: 1) {
      firstChapter {
        title
        pageCount
      }
      lastChapter {
        title
        pageCount
      }
    }
  }`,
      result: {
        getBook: {
          firstChapter: {
            title: 'The Beginning',
            pageCount: 20
          },
          lastChapter: {
            title: 'The End',
            pageCount: 25
          }
        }
      }
    }
  ]

  let service, services
  t.before(async () => {
    services = await createGraphqlServices(t, [
      {
        name: 'books-subgraph',
        file: path.join(__dirname, 'fixtures/books.js'),
        listen: true
      },
      {
        name: 'authors-subgraph',
        file: path.join(__dirname, 'fixtures/authors.js'),
        listen: true
      }
    ])
    const options = {
      subgraphs: services.map((service) => ({
        name: service.name,
        server: { host: service.host }
      }))
    }

    const s = await createComposerService(t, { compose, options })
    service = s.service
  })

  t.beforeEach(() => {
    services.forEach((s) => s.config.reset())
  })

  for (const c of mutations) {
    await t.test(c.name, async (t) => {
      const result = await graphqlRequest(service, c.query, c.variables)

      assert.deepStrictEqual(result, c.result)
    })
  }
})
