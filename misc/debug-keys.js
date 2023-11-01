'use strict'

const fastify = require('fastify')
const { graphqlRequest } = require('../test/helper')
const { default: mercurius } = require('mercurius')
const { getIntrospectionQuery } = require('graphql')
const { compose } = require('../lib')

const PORT = 3000

async function startRouter (services, { port }) {
  const routerPort = port
  const subgraphs = []

  for (const name of Object.keys(services)) {
    const service = services[name]
    service.server = fastify()

    service.server.register(mercurius, { schema: service.schema, resolvers: service.resolvers, graphiql: true })
    service.server.get('/.well-known/graphql-composition', async function (req, reply) {
      return reply.graphql(getIntrospectionQuery())
    })

    service.host = await service.server.listen({ port: ++port })

    console.log(name, service.host + '/graphiql')

    subgraphs.push({
      name,
      entities: service.entities,
      server: {
        host: service.host,
        composeEndpoint: '/.well-known/graphql-composition',
        graphqlEndpoint: '/graphql'
      }
    })
  }

  const composer = await compose({ subgraphs })

  const router = fastify()
  router.register(mercurius, {
    schema: composer.toSdl(),
    resolvers: composer.resolvers,
    graphiql: true
  })

  await router.ready()
  await router.listen({ port: routerPort })

  return router
}

const services = {
  authors: {
    data: {
      authors: {
        1: {
          id: 1,
          name: {
            firstName: 'Peter',
            lastName: 'Dreamer'
          }
        },
        2: {
          id: 2,
          name: {
            firstName: 'John',
            lastName: 'Reporter'
          }
        }
      }
    },
    schema: `
      input IdsIn {
        in: [ID]!
      }
      input WhereIdsIn {
        ids: IdsIn
      }

      type AuthorName {
        firstName: String
        lastName: String
      }

      type Author {
        id: ID
        name: AuthorName
      }

      type Query {
        get(id: ID!): Author
        list: [Author]
        authors (where: WhereIdsIn): [Author]
      }
    `,
    resolvers: {
      Query: {
        get: (_, { id }) => services.authors.data.authors[id],
        list: () => services.authors.data.authors,
        authors: (_, args) => {
          const authors = Object.values(services.authors.data.authors)
            .filter(a => args.where.ids.in.includes(String(a.id)))

          // rotate by 1
          authors.unshift(authors.pop())

          return authors
        }
      }
    },
    entities: {
      Author: {
        keys: [{ field: 'id' }],
        referenceListResolverName: 'authors',
        args: (partialResults) => {
          console.log(' ******** authors.entities.Author args fn', partialResults)
          return { where: { ids: { in: partialResults.map(r => r.id) } } }
        }
      }
    }
  },

  books: {
    data: {
      library: {
        1: {
          id: 1,
          title: 'A Book About Things That Never Happened',
          genre: 'FICTION',
          authorId: 1
        },
        2: {
          id: 2,
          title: 'A Book About Things That Really Happened',
          genre: 'NONFICTION',
          authorId: 2
        },
        3: {
          id: 3,
          title: 'Uknown memories',
          genre: 'NONFICTION',
          authorId: -1
        }
      }
    },
    schema: `
      enum BookGenre {
        FICTION
        NONFICTION
      }

      type Author {
        id: ID
      }

      type Book {
        id: ID!
        title: String
        genre: BookGenre
        author: Author
      }

      type Query {
        getBook(id: ID!): Book
        getBooksByIds(ids: [ID]!): [Book]!
      }
    `,
    resolvers: {
      Query: {
        async getBook (_, { id }) {
          return services.books.data.library[id]
        },
        async getBooksByIds (_, { ids }) {
          return ids.map((id) => services.books.data.library[id])
        }
      },
      Book: {
        author: (parent) => {
          console.log('book subgraph, Book.Author resolver', parent)
          return {
            id: parent.authorId // || services.books.data.library[parent.id]?.authorId
          }
        }
      }
    },
    entities: {
      Book: {
        referenceListResolverName: 'getBooksByIds',
        keys: [{ field: 'id', type: 'Book' }, { field: 'author.id', type: 'Author' }],
        args: (partialResults) => {
          console.log(' ******** books.entities.Book args fn', partialResults)
          return { ids: partialResults.map(r => r.bookId) }
        }
      }
    }
  },

  reviews: {
    schema: `
    type Review {
      id: ID!
      rating: Int!
      content: String!
    }
  
    type Book {
      bookId: ID!
      reviews: [Review]!
    }
  
    type Query {
      getReview(reviewId: ID!): Review
      getReviewBook(bookId: ID!): Book
      getReviewBookByIds(bookIds: [ID]!): [Book]!
      getReviewsByBookId(bookId: ID!): [Review]!
    }
  `,
    data: {
      reviews: {
        1: {
          id: 1,
          rating: 2,
          content: 'Would not read again.'
        },
        2: {
          id: 2,
          rating: 3,
          content: 'So so.'
        },
        3: {
          id: 3,
          rating: 5,
          content: 'Wow.'
        },
        4: {
          id: 4,
          rating: 1,
          content: 'Good to start the fire.'
        }
      },
      books: {
        1: {
          bookId: 1,
          reviews: [1]
        },
        2: {
          bookId: 2,
          reviews: [2]
        },
        3: {
          bookId: 3,
          reviews: [2, 3, 4]
        },
        4: {
          bookId: 4,
          reviews: []
        }
      }
    },
    resolvers: {
      Query: {
        async getReview (_, { reviewId }) {
          return services.reviews.data.reviews[reviewId]
        },
        async getReviewBook (_, { bookId }) {
          const book = structuredClone(services.reviews.data.books[bookId])

          book.reviews = book.reviews.map((rid) => {
            return services.reviews.data.reviews[rid]
          })

          return book
        },
        async getReviewsByBookId (_, { bookId }) {
          return services.reviews.data.books[bookId].reviews.map((rid) => {
            return services.reviews.data.reviews[rid]
          })
        },
        async getReviewBookByIds (_, { bookIds }) {
          return bookIds.map((id) => {
            const book = structuredClone(services.reviews.data.books[id])

            book.reviews = book.reviews.map((rid) => {
              return services.reviews.data.reviews[rid]
            })

            return book
          })
        }
      }
    },
    entities: {
      Book: {
        referenceListResolverName: 'getReviewBookByIds', // query to resolve entity
        keys: [{ field: 'bookId', type: 'Book' }], // keys to retrieve from entity resolver query
        args: (partialResults) => { // when results come from this subgraph
          console.log(' ******** reviews.entities.Book args fn', partialResults)
          return { bookIds: partialResults.map(r => r.bookId) }
        }
        // all the above will be compose to getReviewBookByIds(bookIds: [$mappedIdsFromPartialResults]) { bookId }
        // to retrieve Book
      }
    }
  }
}

// TODO test with/without author

async function test () {
  const router = await startRouter(services, { port: PORT })

  const query = `
  query {
    getReviewBookByIds(bookIds: [1,2,3]) {
      title
      author {
        name { lastName }
      }
      reviews {
        rating
      }
    }
  }
  `

  const response = await graphqlRequest(router, query)

  console.log('==========')
  console.log(query)
  console.log('TADAAAAN')
  console.log(JSON.stringify(response, null, 2))
  console.log('==========')
}

async function main () {
  try {
    await test()
  } catch (err) {
    console.dir(err, { depth: 99 })
  }
}

main()
