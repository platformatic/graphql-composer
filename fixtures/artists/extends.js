module.exports = async (app, opts) => {
  app.graphql.extendSchema(`
    type Song {
      id: ID
    }

    extend type Artist {
      songs: [Song]
    }
  `)
  app.graphql.defineResolvers({
    Artist: {
      songs: (parent, args, context, info) => {
        console.log('resolver Artist songs', {parent, args})
        return [{id:1},{id:2}]
      },
    },
  })
}
