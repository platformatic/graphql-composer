'use strict';
const schema = `
  type Review {
    id: ID!
    rating: Int!
    content: String!
  }

  type Book {
    id: ID!
    reviews: [Review]!
  }

  type Query {
    getReview(id: ID!): Review
    getReviewBook(id: ID!): Book
    getReviewBookByIds(ids: [ID]!): [Book]!
    getReviewsByBookId(id: ID!): [Review]!
  }
`;
const reviews = {
  1: {
    id: 1,
    rating: 2,
    content: 'Would not read again.'
  }
};
const books = {
  1: {
    id: 1,
    reviews: [1]
  }
};
const resolvers = {
  Query: {
    async getReview(_, { id }) {
      return reviews[id];
    },
    async getReviewBook(_, { id }) {
      const book = structuredClone(books[id]);

      book.reviews = book.reviews.map((rid) => {
        return reviews[rid];
      });

      return book;
    },
    async getReviewsByBookId(_, { id }) {
      return books[id].reviews.map((rid) => {
        return reviews[rid];
      });
    },
    async getReviewBookByIds(_, { ids }) {
      return ids.map((id) => {
        const book = structuredClone(books[id]);

        book.reviews = book.reviews.map((rid) => {
          return reviews[rid];
        });

        return book;
      });
    }
  }
};
const entities = {
  Book: {
    referenceListResolverName: 'getReviewBookByIds',
    foreignKeyFields: ['id'],
    adapter(partialResult) {
      return {
        ids: [partialResult.id]
      };
    }
  }
};

module.exports = { entities, resolvers, schema };
