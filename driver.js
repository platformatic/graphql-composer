'use strict'
// const { walkSchema } = require('./visitor')
const { startRouter } = require('./test/helper')

async function main () {
  const fakeTestContext = { after () {} }
  const server = await startRouter(fakeTestContext, [
    'authors-subgraph',
    'books-subgraph',
    'reviews-subgraph'
  ])

  server.get('/', async function (req, reply) {
    try {
      const query = `
        query GetBookById($id: ID!) {
          getReviewBook(id: $id) {
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
      return reply.graphql(query, null, { id: 1 })
    } catch (err) {
      console.log(err)
    }
  })

  server.listen({ port: 4000 })
}

main()

// Comment out for the linter. Uncomment later.
// function renameType (schema, from, to) {
//   const visitor = {
//     schema (node) {

//     },
//     queryType (node) {
//       if (node.name === from) {
//         node.name = to;
//       }
//     },
//     mutationType (node) {
//       if (node.name === from) {
//         node.name = to;
//       }
//     },
//     subscriptionType (node) {
//       if (node.name === from) {
//         node.name = to;
//       }
//     },
//     type (node) {
//       if (node.name === from) {
//         node.name = to;
//       }

//       console.log('visited type');
//       console.log(node);
//     },
//     directive (node) {
//       // console.log('visited directive');
//     },
//     field (node) {
//       // console.log('visited field');
//     },
//     argument (node) {

//     }
//   };

//   walkSchema(schema, visitor);
// }
