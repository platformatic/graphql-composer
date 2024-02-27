'use strict'

const { compose } = require('@platformatic/graphql-composer')
const Fastify = require('fastify')
const Mercurius = require('mercurius')
const { default: pino } = require('pino')

const bookGql = {
  schema: `
  enum BookGenre {
    FICTION
    NONFICTION
  }

  type Book {
    id: ID!
    title: String
    genre: BookGenre
  }

  type Query {
    getBook(id: ID!): Book
    getBooks(ids: [ID]!): [Book]!
  }
`,
  data: {
    library: {
      1: {
        id: 1,
        title: 'A Book About Things That Never Happened',
        genre: 'FICTION'
      },
      2: {
        id: 2,
        title: 'A Book About Things That Really Happened',
        genre: 'NONFICTION'
      }
    }
  },
  resolvers: {
    Query: {
      getBook: (_, { id }) => bookGql.data.library[id],
      getBooks: (_, { ids }) => ids.map((id) => bookGql.data.library[id]).filter(b => !!b)
    }
  }
}

const reviewGql = {
  schema: `
  input ReviewInput {
    bookId: ID!
    rating: Int!
    content: String!
  }

  type Review {
    id: ID!
    rating: Int!
    content: String!
  }

  type Book {
    id: ID!
    rate: Int
    reviews: [Review]!
  }

  type ReviewWithBook {
    id: ID!
    rating: Int!
    content: String!
    book: Book!
  }

  type Query {
    getReview(id: ID!): Review
    getReviews(ids: [ID]!): Review
    getReviewBooks(bookIds: [ID]!): [Book]
  }

  type Mutation {
    createReview(review: ReviewInput!): Review!
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
      }
    },
    books: {
      1: {
        id: 1,
        rate: 3,
        reviews: [1]
      },
      2: {
        id: 2,
        rate: 4,
        reviews: [2]
      }
    }
  },
  resolvers: {
    Query: {
      getReview: (_, { id }) => reviewGql.data.reviews[id],
      getReviews: (_, { ids }) => ids.map(id => reviewGql.data.reviews[id]).filter(b => !!b),
      getReviewBooks (_, { bookIds }) {
        return bookIds.map((id) => {
          if (!reviewGql.data.books[id]) { return null }
          const book = structuredClone(reviewGql.data.books[id])

          book.reviews = book.reviews.map((rid) => {
            return reviewGql.data.reviews[rid]
          })

          return book
        })
          .filter(b => !!b)
      }
    },
    Mutation: {
      createReview () {
        // ...
      }
    }
  }
}

async function main () {
  // Start the 2 sub services
  const bookService = Fastify()
  bookService.register(Mercurius, {
    schema: bookGql.schema,
    resolvers: bookGql.resolvers
  })
  const booksServiceHost = await bookService.listen({ port: 3001 })

  const reviewService = Fastify()
  reviewService.register(Mercurius, {
    schema: reviewGql.schema,
    resolvers: reviewGql.resolvers
  })
  const reviewsServiceHost = await reviewService.listen({ port: 3002 })

  // Get schema information from subgraphs
  const composer = await compose({
    logger: pino({ level: 'debug' }),
    subgraphs: [
      {
        // Books subgraph information
        name: 'books',
        // Subgraph server to connect to
        server: {
          host: booksServiceHost
        },
        // Configuration for working with Book entities in this subgraph
        entities: {
          Book: {
            pkey: 'id',
            // Resolver for retrieving multiple Books
            resolver: {
              name: 'getBooks',
              argsAdapter: (partialResults) => ({
                ids: partialResults.map(r => r.id)
              })
            }
          }
        }
      },
      {
        // Reviews subgraph information
        name: 'reviews',
        server: {
          host: reviewsServiceHost
        },
        // Configuration for Review entity
        entities: {
          Review: {
            pkey: 'id',
            // Resolver for retrieving multiple Books
            resolver: {
              name: 'getReviews',
              argsAdapter: (partialResults) => ({
                ids: partialResults.map(r => r.id)
              })
            }
          },
          // Book entity is here too
          Book: {
            pkey: 'id',
            // Resolver for retrieving multiple Books
            resolver: {
              name: 'getReviewBooks',
              argsAdapter: (partialResults) => ({
                bookIds: partialResults.map(r => r.id)
              })
            }
          }
        }
      }
    ]
  })

  // Create a Fastify server that uses the Mercurius GraphQL plugin
  const composerService = Fastify()

  composerService.register(Mercurius, {
    schema: composer.toSdl(),
    resolvers: composer.resolvers,
    graphiql: true
  })

  await composerService.ready()
  await composerService.listen({ port: 3000 })

  // Then query the composer service
  // { getBook (id: 1) { id title reviews { content rating } } }
}

main()
