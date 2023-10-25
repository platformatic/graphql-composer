module.exports = async (app, opts) => {
  app.graphql.extendSchema(`
    type Artist {
      id: ID
    }

    extend type Song {
      artist: Artist
    }
  `)
  app.graphql.defineResolvers({
    Song: {
      Artist: (parent, args, context, info) => {
        console.log('resolver Song Artist', {parent, args})
        return {id:parent.singerId}
      },
    },
  })
}
