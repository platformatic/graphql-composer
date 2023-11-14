'use strict'

const assert = require('node:assert/strict')
const { test } = require('node:test')
const { graphqlRequest, startRouter } = require('./helper')

test('entities', async () => {
  await test('throws if argsAdapter function does not return an object', async (t) => {
    const overrides = {
      subgraphs: {
        'books-subgraph': {
          entities: {
            Book: { argsAdapter: () => 'nope' }
          }
        }
      }
    }

    const router = await startRouter(t, ['books-subgraph', 'reviews-subgraph'], overrides)
    const query = `
    query {
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
    }
  `

    await assert.rejects(async () => {
      await graphqlRequest(router, query)
    }, (err) => {
      assert.strictEqual(Array.isArray(err), true)
      assert.strictEqual(err.length, 1)
      assert.strictEqual(err[0].message, 'argsAdapter did not return an object. returned nope.')
      assert.deepStrictEqual(err[0].path, ['getReviewBook'])
      return true
    })
  })

  await test('throws if argsAdapter function throws', async (t) => {
    const overrides = {
      subgraphs: {
        'books-subgraph': {
          entities: {
            Book: {
              referenceListResolverName: 'getBooksByIds',
              argsAdapter: () => { throw new Error('boom') }
            }
          }
        }
      }
    }

    const router = await startRouter(t, ['books-subgraph', 'reviews-subgraph'], overrides)
    const query = `
    query {
      getReviewBook(id: 1) {
        title
      }
    }
  `

    await assert.rejects(async () => {
      await graphqlRequest(router, query)
    }, (err) => {
      assert.strictEqual(Array.isArray(err), true)
      assert.strictEqual(err.length, 1)
      assert.strictEqual(err[0].message, 'Error running argsAdapter for getBooksByIds')
      assert.deepStrictEqual(err[0].path, ['getReviewBook'])
      return true
    })
  })

  await test('should resolve foreign types with nested keys', async (t) => {
    const query = `{
      getReviewBookByIds(ids: [1,2,3]) {
        title
        author { name { lastName } }
        reviews { rating }
      }
    }`

    const expectedResponse = {
      getReviewBookByIds:
        [{
          title: 'A Book About Things That Never Happened',
          author: { name: { lastName: 'Pluck' } },
          reviews: [{ rating: 2 }]
        },
        {
          title: 'A Book About Things That Really Happened',
          author: { name: { lastName: 'Writer' } },
          reviews: [{ rating: 3 }]
        },
        {
          title: 'Uknown memories',
          author: { name: null },
          reviews: [{ rating: 3 }, { rating: 5 }, { rating: 1 }]
        }]
    }

    const extend = {
      'authors-subgraph': (data) => {
        return {
          schema: `
          input IdsIn {
            in: [ID]!
          }
          input WhereIdsIn {
            ids: IdsIn
          }
   
          extend type Query {
            authors (where: WhereIdsIn): [Author]
          }
          `,
          resolvers: {
            Query: {
              authors: (_, args) => Object.values(data.authors).filter(a => args.where.ids.in.includes(String(a.id)))
            }
          }
        }
      },
      'books-subgraph': (data) => {
        data.library[1].authorId = 1
        data.library[2].authorId = 2
        data.library[3] = {
          id: 3,
          title: 'Uknown memories',
          genre: 'NONFICTION',
          authorId: -1
        }

        return {
          schema: `
            type Author {
              id: ID
            }
            
            extend type Book {
              author: Author
            }
          `,
          resolvers: {
            Book: {
              author: (parent) => ({ id: parent.authorId || data.library[parent.id]?.authorId })
            }
          }
        }
      }
    }
    const overrides = {
      subgraphs: {
        'books-subgraph': {
          entities: {
            Book: {
              referenceListResolverName: 'getBooksByIds',
              argsAdapter: (partialResults) => ({ ids: partialResults.map(r => r.id) }),
              keys: [{ field: 'id', type: 'Book' }, { field: 'author.id', type: 'Author' }]
            }
          }
        },
        'authors-subgraph': {
          entities: {
            Author: {
              referenceListResolverName: 'authors',
              argsAdapter: (partialResults) => ({ where: { ids: { in: partialResults.map(r => r.id) } } }),
              keys: [{ field: 'id', type: 'Author' }]
            }
          }
        }
      }
    }

    const router = await startRouter(t, ['authors-subgraph', 'books-subgraph', 'reviews-subgraph'], overrides, extend)

    const response = await graphqlRequest(router, query)

    assert.deepStrictEqual(response, expectedResponse)
  })

  await test('should not involve type keys that are not in the selection', async (t) => {
    const query = `{
      getReviewBookByIds(ids: [1,2,3]) {
        title
        reviews { rating }
      }
    }`

    const expectedResponse = {
      getReviewBookByIds:
        [{
          title: 'A Book About Things That Never Happened',
          reviews: [{ rating: 2 }]
        },
        {
          title: 'A Book About Things That Really Happened',
          reviews: [{ rating: 3 }]
        },
        {
          title: 'Uknown memories',
          reviews: [{ rating: 3 }, { rating: 5 }, { rating: 1 }]
        }]
    }

    let calls = 0
    const extend = {
      'authors-subgraph': (data) => {
        return {
          schema: `
          input IdsIn {
            in: [ID]!
          }
          input WhereIdsIn {
            ids: IdsIn
          }
   
          extend type Query {
            authors (where: WhereIdsIn): [Author]
          }
          `,
          resolvers: {
            Query: {
              authors: (_, args) => {
                calls++
                return []
              }
            }
          }
        }
      },
      'books-subgraph': (data) => {
        data.library[1].authorId = 1
        data.library[2].authorId = 2
        data.library[3] = {
          id: 3,
          title: 'Uknown memories',
          genre: 'NONFICTION',
          authorId: -1
        }

        return {
          schema: `
            type Author {
              id: ID
            }
            
            extend type Book {
              author: Author
            }
          `,
          resolvers: {
            Book: {
              author: (parent) => {
                calls++
                return { id: null }
              }
            }
          }
        }
      }
    }
    const overrides = {
      subgraphs: {
        'books-subgraph': {
          entities: {
            Book: {
              referenceListResolverName: 'getBooksByIds',
              keys: [{ field: 'id', type: 'Book' }, { field: 'author.id', type: 'Author' }],
              argsAdapter: (partialResults) => ({ ids: partialResults.map(r => r.id) })
            }
          }
        },
        'authors-subgraph': {
          entities: {
            Author: {
              referenceListResolverName: 'authors',
              keys: [{ field: 'id', type: 'Author' }],
              argsAdapter: () => {
                calls++
                return []
              }
            }
          }
        }
      }
    }

    const router = await startRouter(t, ['authors-subgraph', 'books-subgraph', 'reviews-subgraph'], overrides, extend)

    const response = await graphqlRequest(router, query)

    assert.strictEqual(calls, 0)
    assert.deepStrictEqual(response, expectedResponse)
  })

  await test('should run the same query with different args', async (t) => {
    const queries = [
      `{
        getReviewBookByIds(ids: [1]) {
          title
          reviews { rating }
        }
      }`,
      `{
        getReviewBookByIds(ids: [2]) {
          title
          reviews { rating }
        }
      }`
    ]

    const expectedResponses = [{
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

    const router = await startRouter(t, ['books-subgraph', 'reviews-subgraph'])

    for (let i = 0; i < queries.length; i++) {
      const response = await graphqlRequest(router, queries[i])
      assert.deepStrictEqual(response, expectedResponses[i])
    }
  })

  await test('should handle null in results', async (t) => {
    const query =
      `{
        getReviewBookByIds(ids: [99,1,101]) {
          title
          reviews { rating }
        }
      }`

    const expectedResponse = {
      getReviewBookByIds: [{
        reviews: [{ rating: 2 }],
        title: 'A Book About Things That Never Happened'
      }]
    }

    const router = await startRouter(t, ['books-subgraph', 'reviews-subgraph'])

    const response = await graphqlRequest(router, query)
    assert.deepStrictEqual(response, expectedResponse)
  })

  await test('should handle null results', async (t) => {
    const query =
      `{
        getReviewBookByIds(ids: [-1,-2,-3]) {
          title
          reviews { rating }
        }
      }`

    const expectedResponse = {
      getReviewBookByIds: []
    }

    const router = await startRouter(t, ['books-subgraph', 'reviews-subgraph'])

    const response = await graphqlRequest(router, query)
    assert.deepStrictEqual(response, expectedResponse)
  })

  await test('should resolve foreign types referenced in different results', async (t) => {
    const query = `{
        booksByAuthors(authorIds: [10,11,12]) {
          title
          author { name { firstName, lastName } }
        }
      }`
    const expectedResponse = {
      booksByAuthors: [
        { title: 'A Book About Things That Never Happened', author: { name: { firstName: 'John Jr.', lastName: 'Johnson' } } },
        { title: 'A Book About Things That Really Happened', author: { name: { firstName: 'John Jr.', lastName: 'Johnson' } } },
        { title: 'From the universe', author: { name: { firstName: 'Cindy', lastName: 'Connor' } } },
        { title: 'From another world', author: { name: { firstName: 'Cindy', lastName: 'Connor' } } }
      ]
    }

    const extend = {
      'authors-subgraph': (data) => {
        data.authors[10] = {
          id: 10,
          name: {
            firstName: 'John Jr.',
            lastName: 'Johnson'
          }
        }
        data.authors[11] = {
          id: 11,
          name: {
            firstName: 'Cindy',
            lastName: 'Connor'
          }
        }

        return {
          schema: `
            input IdsIn {
              in: [ID]!
            }
            input WhereIdsIn {
              ids: IdsIn
            }
     
            extend type Query {
              authors (where: WhereIdsIn): [Author]
            }
            `,
          resolvers: {
            Query: {
              authors: (_, args) => Object.values(data.authors).filter(a => args.where.ids.in.includes(String(a.id)))
            }
          }
        }
      },
      'books-subgraph': (data) => {
        data.library[1].authorId = 10
        data.library[2].authorId = 10
        data.library[3] = {
          id: 3,
          title: 'From the universe',
          genre: 'FICTION',
          authorId: 11
        }
        data.library[4] = {
          id: 4,
          title: 'From another world',
          genre: 'FICTION',
          authorId: 11
        }

        return {
          schema: `
              type Author {
                id: ID
              }
              
              extend type Book {
                author: Author
              }

              extend type Query {
                booksByAuthors(authorIds: [ID!]!): [Book]
              }
            `,
          resolvers: {
            Book: {
              author: (parent) => ({ id: parent.authorId || data.library[parent.id]?.authorId })
            },
            Query: {
              booksByAuthors: (parent, { authorIds }) => Object.values(data.library).filter(book => authorIds.includes(String(book.authorId)))
            }
          }
        }
      }
    }
    const overrides = {
      subgraphs: {
        'books-subgraph': {
          entities: {
            Book: {
              referenceListResolverName: 'getBooksByIds',
              argsAdapter: (partialResults) => ({ ids: partialResults.map(r => r.id) }),
              keys: [{ field: 'id', type: 'Book' }, { field: 'author.id', type: 'Author' }]
            }
          }
        },
        'authors-subgraph': {
          entities: {
            Author: {
              referenceListResolverName: 'authors',
              argsAdapter: (partialResults) => ({ where: { ids: { in: partialResults.map(r => r.id) } } }),
              keys: [{ field: 'id', type: 'Author' }]
            }
          }
        }
      }
    }

    const router = await startRouter(t, ['authors-subgraph', 'books-subgraph', 'reviews-subgraph'], overrides, extend)

    const response = await graphqlRequest(router, query)

    assert.deepStrictEqual(response, expectedResponse)
  })

  await test('should resolve nested foreign types with lists in result', async (t) => {
    const query = `{
      booksByAuthors(authorIds: [10,11,12]) {
        title
        author { 
          name { firstName, lastName } 
          books { 
            reviews { rating } 
          }
        }
      }
    }`

    const expectedResponse = { booksByAuthors: [{ title: 'A Book About Things That Never Happened', author: { name: { firstName: 'Mark', lastName: 'Dark' }, books: [{ reviews: [{ rating: 2 }] }, { reviews: [{ rating: 3 }] }] } }, { title: 'A Book About Things That Really Happened', author: { name: { firstName: 'Mark', lastName: 'Dark' }, books: [{ reviews: [{ rating: 2 }] }, { reviews: [{ rating: 3 }] }] } }, { title: 'Watering the plants', author: { name: { firstName: 'Daisy', lastName: 'Dyson' }, books: [{ reviews: [{ rating: 3 }, { rating: 5 }, { rating: 1 }] }, { reviews: [] }] } }, { title: 'Pruning the branches', author: { name: { firstName: 'Daisy', lastName: 'Dyson' }, books: [{ reviews: [{ rating: 3 }, { rating: 5 }, { rating: 1 }] }, { reviews: [] }] } }] }

    const extend = {
      'authors-subgraph': (data) => {
        data.authors[10] = {
          id: 10,
          name: {
            firstName: 'Mark',
            lastName: 'Dark'
          }
        }
        data.authors[11] = {
          id: 11,
          name: {
            firstName: 'Daisy',
            lastName: 'Dyson'
          }
        }

        return {
          schema: `
              input IdsIn {
                in: [ID]!
              }
              input WhereIdsIn {
                ids: IdsIn
              }
  
              type Book {
                id: ID!
              }
       
              extend type Query {
                authors (where: WhereIdsIn): [Author]
              }
  
              extend type Author {
                books: [Book]
              }
            `,
          resolvers: {
            Query: {
              authors: (_, args) => Object.values(data.authors).filter(a => args.where.ids.in.includes(String(a.id)))
            },
            Author: {
              books: (author, args, context, info) => {
                // pretend to call books-subgraph service
                const books = {
                  10: [{ id: 1 }, { id: 2 }],
                  11: [{ id: 3 }, { id: 4 }]
                }
                return books[author?.id]
              }
            }
          }
        }
      },
      'books-subgraph': (data) => {
        data.library[1].authorId = 10
        data.library[2].authorId = 10
        data.library[3] = {
          id: 3,
          title: 'Watering the plants',
          genre: 'NONFICTION',
          authorId: 11
        }
        data.library[4] = {
          id: 4,
          title: 'Pruning the branches',
          genre: 'NONFICTION',
          authorId: 11
        }

        return {
          schema: `
            type Author {
              id: ID
            }
            
            extend type Book {
              author: Author
            }
  
            extend type Query {
              booksByAuthors(authorIds: [ID!]!): [Book]
            }
          `,
          resolvers: {
            Book: {
              author: (parent) => ({ id: parent.authorId || data.library[parent.id]?.authorId })
            },
            Query: {
              booksByAuthors: (parent, { authorIds }) => Object.values(data.library).filter(book => authorIds.includes(String(book.authorId)))
            }
          }
        }
      }
    }
    const overrides = {
      subgraphs: {
        'books-subgraph': {
          entities: {
            Book: {
              referenceListResolverName: 'getBooksByIds',
              argsAdapter: (partialResults) => ({ ids: partialResults.map(r => r.id) }),
              keys: [{ field: 'id', type: 'Book' }, { field: 'author.id', type: 'Author' }]
            }
          }
        },
        'authors-subgraph': {
          entities: {
            Author: {
              referenceListResolverName: 'authors',
              argsAdapter: (partialResults) => ({ where: { ids: { in: partialResults.map(r => r.id) } } }),
              keys: [{ field: 'id', type: 'Author' }]
            },
            Book: {
              keys: [{ field: 'id' }]
            }
          }
        }
      }
    }

    const router = await startRouter(t, ['authors-subgraph', 'books-subgraph', 'reviews-subgraph'], overrides, extend)

    const response = await graphqlRequest(router, query)

    assert.deepStrictEqual(response, expectedResponse)
  })

  test('should use multiple subgraphs', async t => {
    const requests = [
    // query multiple services
      {
        query: '{ songs (ids: [1,2,3]) { title, singer { firstName, lastName, profession } } }',
        expected: {
          songs: [
            { title: 'Every you every me', singer: { firstName: 'Brian', lastName: 'Molko', profession: 'Singer' } },
            { title: 'The bitter end', singer: { firstName: 'Brian', lastName: 'Molko', profession: 'Singer' } },
            { title: 'Vieni via con me', singer: { firstName: 'Roberto', lastName: 'Benigni', profession: 'Director' } }]
        }
      },

      // get all songs by singer
      {
        query: '{ artists (ids: ["103","102"]) { lastName, songs { title } } }',
        expected: {
          artists: [
            { lastName: 'Benigni', songs: [{ title: 'Vieni via con me' }] },
            { lastName: 'Molko', songs: [{ title: 'Every you every me' }, { title: 'The bitter end' }] }]
        }
      },

      // query multiple subgraph on the same node
      {
        query: '{ artists (ids: ["103","101","102"]) { lastName, songs { title }, movies { title } } }',
        expected: {
          artists: [
            { lastName: 'Nolan', songs: [], movies: [{ title: 'Interstellar' }, { title: 'Oppenheimer' }] },
            { lastName: 'Benigni', songs: [{ title: 'Vieni via con me' }], movies: [{ title: 'La vita é bella' }] },
            { lastName: 'Molko', songs: [{ title: 'Every you every me' }, { title: 'The bitter end' }], movies: [] }
          ]
        }
      },

      // double nested
      {
        query: '{ artists (ids: ["103"]) { songs { title, singer { firstName, lastName } } } }',
        expected: { artists: [{ songs: [{ title: 'Every you every me', singer: { firstName: 'Brian', lastName: 'Molko' } }, { title: 'The bitter end', singer: { firstName: 'Brian', lastName: 'Molko' } }] }] }
      },

      // nested and nested times
      {
        query: '{ artists (ids: ["103"]) { songs { singer { songs { singer { songs { title } }} } } } }',
        expected: { artists: [{ songs: [{ singer: { songs: [{ singer: { songs: [{ title: 'Every you every me' }, { title: 'The bitter end' }] } }, { singer: { songs: [{ title: 'Every you every me' }, { title: 'The bitter end' }] } }] } }, { singer: { songs: [{ singer: { songs: [{ title: 'Every you every me' }, { title: 'The bitter end' }] } }, { singer: { songs: [{ title: 'Every you every me' }, { title: 'The bitter end' }] } }] } }] }] }
      }
    ]

    const info = {
      defaultArgsAdapter: (partialResults) => {
        return { ids: partialResults.map(r => r?.id) }
      }
    }

    const composer = await startRouter(t, ['artists-subgraph', 'movies-subgraph', 'songs-subgraph'], info)

    for (const request of requests) {
      const response = await graphqlRequest(composer, request.query, request.variables)

      assert.deepStrictEqual(response, request.expected, 'should get expected result from composer service for query\n' + request.query)
    }
  })

  // TODO results: list, single, nulls, partials
  // TODO when an entity is spread across multiple subgraphs
  // TODO should throw error (timeout?) resolving type entity

// TODO crud ops
// TODO subscriptions
})
