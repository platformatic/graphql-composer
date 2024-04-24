function createDefaultHeadersAdapter () {
  const exclude = ['content-type', 'content-length']
  const predicate = ([name]) => !exclude.includes(name)

  return function headersAdapter (headers) {
    return Object.fromEntries(Object.entries(headers).filter(predicate))
  }
}

module.exports = {
  createDefaultHeadersAdapter
}
