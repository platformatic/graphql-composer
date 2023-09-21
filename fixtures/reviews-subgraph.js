'use strict'
const schema = `
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
    getReviewBook(id: ID!): Book
    getReviewBookByIds(ids: [ID]!): [Book]!
    getReviewsByBookId(id: ID!): [Review]!
  }

  type Mutation {
    createReview(review: ReviewInput!): Review!
  }

  type Subscription {
    reviewPosted: ReviewWithBook!
  }
`
let reviews
let books

function reset () {
  reviews = {
    1: {
      id: 1,
      rating: 2,
      content: 'Would not read again.'
    }
  }

  books = {
    1: {
      id: 1,
      reviews: [1]
    }
  }
}

reset()

const resolvers = {
  Query: {
    async getReview (_, { id }) {
      return reviews[id]
    },
    async getReviewBook (_, { id }) {
      const book = structuredClone(books[id])

      book.reviews = book.reviews.map((rid) => {
        return reviews[rid]
      })

      return book
    },
    async getReviewsByBookId (_, { id }) {
      return books[id].reviews.map((rid) => {
        return reviews[rid]
      })
    },
    async getReviewBookByIds (_, { ids }) {
      return ids.map((id) => {
        const book = structuredClone(books[id])

        book.reviews = book.reviews.map((rid) => {
          return reviews[rid]
        })

        return book
      })
    }
  },
  Mutation: {
    async createReview (_, { review: reviewInput }, context) {
      const id = Object.keys(reviews).length + 1
      const { bookId, content, rating } = reviewInput
      const review = { id, rating, content }

      reviews[id] = review
      books[bookId] ??= { id: bookId, reviews: [] }
      const book = books[bookId]
      book.reviews.push(id)
      context.app.graphql.pubsub.publish({
        topic: 'REVIEW_POSTED',
        payload: {
          reviewPosted: {
            ...review,
            book: {
              id: bookId,
              reviews: book.reviews.map((rid) => {
                return reviews[rid]
              })
            }
          }
        }
      })

      return review
    }
  },
  Subscription: {
    reviewPosted: {
      subscribe: (root, args, ctx) => {
        return ctx.pubsub.subscribe('REVIEW_POSTED')
      }
    }
  }
}
const entities = {
  Book: {
    referenceListResolverName: 'getReviewBookByIds',
    foreignKeyFields: ['id'],
    adapter (partialResult) {
      return {
        ids: [partialResult.id]
      }
    }
  }
}

module.exports = { entities, reset, resolvers, schema }
