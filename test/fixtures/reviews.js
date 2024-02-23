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
    bookId: ID!
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
    getReviewBook(id: ID!): Book
    getReviewBookByIds(ids: [ID]!): [Book]!
    getReviewsByBookId(id: ID!): [Review]!
  }

  type Mutation {
    createReview(review: ReviewInput!): Review!
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
  }

  books = {
    1: {
      bookId: 1,
      rate: 3,
      reviews: [1]
    },
    2: {
      bookId: 2,
      rate: 4,
      reviews: [2]
    },
    3: {
      bookId: 3,
      rate: 5,
      reviews: [2, 3, 4]
    },
    4: {
      bookId: 4,
      rate: null,
      reviews: []
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
      if (!books[id]) { return null }
      const book = structuredClone(books[id])

      book.reviews = book.reviews.map((rid) => {
        return reviews[rid]
      })

      return book
    },
    async getReviewsByBookId (_, { id }) {
      return books[id]?.reviews.map((rid) => {
        return reviews[rid]
      })
    },
    async getReviewBookByIds (_, { ids }) {
      return ids.map((id) => {
        if (!books[id]) { return null }
        const book = structuredClone(books[id])

        book.reviews = book.reviews.map((rid) => {
          return reviews[rid]
        })

        return book
      })
        .filter(b => !!b)
    }
  },
  Mutation: {
    async createReview (_, { review: reviewInput }, context) {
      const id = Object.keys(reviews).length + 1
      const { bookId, content, rating } = reviewInput
      const review = { id, rating, content }

      reviews[id] = review
      books[bookId] ??= { bookId, reviews: [] }
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
  }
}
const entities = {
  Book: {
    pkey: 'bookId',
    resolver: {
      name: 'getReviewBookByIds',
      argsAdapter (partialResults) {
        return {
          ids: partialResults.map(r => r.id)
        }
      }
    }
  }
}

module.exports = { entities, reset, resolvers, schema }
