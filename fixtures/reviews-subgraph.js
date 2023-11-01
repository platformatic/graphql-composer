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
      id: 1,
      reviews: [1]
    },
    2: {
      id: 2,
      reviews: [2]
    },
    3: {
      id: 3,
      reviews: [2, 3, 4]
    },
    4: {
      id: 4,
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
      if (!books[id]) { return }
      const book = structuredClone(books[id])

      book.reviews = book?.reviews.map((rid) => {
        return reviews[rid]
      })

      return book
    },
    async getReviewsByBookId (_, { id }) {
      return books?.[id].reviews.map((rid) => {
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
    keys: [{ field: 'id', type: 'Book' }],
    argsAdapter (partialResults) {
      return {
        ids: partialResults?.map(r => r?.id)
      }
    }
  }
}

module.exports = { name: 'reviews', entities, reset, resolvers, schema }
