'use strict'

const schema = `
  input AuthorTodoInput {
    task: String
  }

  input AuthorAddressInput {
    street: String!
    city: String!
    zip: String!
  }
  
  input AuthorInput {
    firstName: String!
    lastName: String!
    address: AuthorAddressInput
    todos: [AuthorTodoInput]
  }
  
  type AuthorTodo {
    task: String
  }

  type AuthorName {
    firstName: String
    lastName: String
  }

  type Author {
    id: ID
    name: AuthorName
    todos(id: ID!): [AuthorTodo]
  }

  type BlogPostPublishEvent {
    authorId: ID!
  }

  type Query {
    get(id: ID!): Author
    list: [Author]
  }

  type Mutation {
    createAuthor(author: AuthorInput!): Author!
    batchCreateAuthor(authors: [AuthorInput]!): [Author]!
    publishBlogPost(authorId: ID!): Boolean!
  }
`

const data = {
  authors: null,
  todos: null
}

function reset () {
  data.authors = {
    1: {
      id: 1,
      name: {
        firstName: 'Peter',
        lastName: 'Pluck'
      }
    },
    2: {
      id: 2,
      name: {
        firstName: 'John',
        lastName: 'Writer'
      }
    }
  }

  data.todos = {
    1: {
      id: 1,
      authorId: 1,
      task: 'Write another book'
    },
    2: {
      id: 2,
      authorId: 1,
      task: 'Get really creative'
    }
  }
}

reset()

const resolvers = {
  Query: {
    async get (_, { id }) {
      return data.authors[id]
    },
    async list () {
      return Object.values(data.authors)
    }
  },
  Mutation: {
    async createAuthor (_, { author: authorInput }) {
      const id = Object.keys(data.authors).length + 1
      const author = {
        id,
        name: { ...authorInput }
      }

      data.authors[id] = author
      return author
    },

    async batchCreateAuthor (_, { authors: authorsInput }) {
      const created = []
      for (const authorInput of authorsInput) {
        const id = Object.keys(data.authors).length + 1
        const author = {
          id,
          name: { ...authorInput }
        }

        data.authors[id] = author
        created.push(author)
      }
      return created
    },

    async publishBlogPost (_, { authorId }, context) {
      context.app.graphql.pubsub.publish({
        topic: 'PUBLISH_BLOG_POST',
        payload: {
          postPublished: {
            authorId
          }
        }
      })

      return true
    }
  },
  Author: {
    async todos (_, { id }) {
      return Object.values(data.todos).filter((t) => {
        return String(t.id) === id
      })
    }
  }
}

module.exports = { schema, reset, resolvers, data }
