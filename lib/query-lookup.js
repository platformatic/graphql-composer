'use strict'

const { createFieldId } = require('./fields')
const { createQueryNode, createQuery, createDeferredQuery, addDeferredQueryField } = require('./query-builder')
const { mergeMaps, collectNodeArgs, collectPlainArgs, pathJoin } = require('./utils')

/**
 * !important: the "lookup" functions in there:
 * - MUST only gather information to compose queries
 * - MUST NOT contain any logic for deferred/entities or so
 */

/**
 * @typedef CollectedQueries
 * @property {{Map<String, QueryNode>}} queries - the list of query-nodes, identified by path / the path is the map key
 * @property {{Map<String, DeferredQueryNode>}} deferred - the list of deferred query-nodes, identified by path / the path is the map key
 */

/**
 * collect queries to subgraph to resolve a query, starting from the resolver
 * queries can be on the same subgraph, so ready to be executed (when the parent node is complete and the parent result is used as args)
 * or deferred, that means that the query need to be computed to be executed on another subgraph
 * as for now, there's no strategy, queries execution is cascade traversing the request query schema vertically
 *
 * TODO refactor to a class, to avoid passing all the common stuff on recursion
 *
 * @returns {CollectedQueries}
 */
function collectQueries ({
  subgraphName, queryFieldNode, path = '', fieldId, parent, args,
  fragmentFieldTypeName,
  // references
  types, fields, aliases,
  // root: collect root queries
  root,
  // override resolver
  resolver,
  selection,
  // TODO createcontext fn
  context
}) {
  const queries = new Map()
  const deferreds = new Map()
  const order = new Set()

  const field = fields[fieldId]
  if (!field) {
    const resolverName = resolver ? resolver.name : queryFieldNode.name?.value
    const queryNode = createQueryNode({
      subgraphName,
      path,
      field,
      fieldId,
      queryFieldNode,
      parent,
      root,
      query: createQuery({
        operation: context.info ? context.info.operation.operation : '',
        resolver: resolver ?? { name: resolverName },
        selection: [],
        args: collectPlainArgs(args, queryFieldNode.arguments, context.info, types)
      })
    })
    const querySelection = queryFieldNode

    addDeferredQuery({ deferreds, context, path, queryNode, querySelection, field })
    return { queries, deferreds, order }
  }

  const rootScalar = root && field.src.type.kind === 'SCALAR'
  const queryFieldSelections = rootScalar
    ? [queryFieldNode]
    : queryFieldNode.selectionSet?.selections

  if (!queryFieldSelections || queryFieldSelections.length < 1) {
    return { queries, deferreds, order }
  }

  const resolverName = resolver ? resolver.name : queryFieldNode.name?.value
  const cpath = pathJoin(path, queryFieldNode.name?.value)
  const fieldQueryPath = queryPath(cpath, subgraphName)

  const queryNode = createQueryNode({
    subgraphName,
    path,
    field,
    fieldId,
    queryFieldNode,

    // TODO maybe parent and root are redundant
    parent,
    root,
    query: createQuery({
      operation: context.info ? context.info.operation.operation : '',
      // TODO createResolver fn
      resolver: resolver ?? { name: resolverName },
      selection: [],
      args: collectPlainArgs(args, queryFieldNode.arguments, context.info, types)
    })
  })

  // root query for a scalar type is a single query on current subgraph
  if (rootScalar) {
    order.add(fieldQueryPath)
    queries.set(fieldQueryPath, queryNode)
    return { queries, deferreds, order }
  }

  const fieldTypeName = fragmentFieldTypeName ?? field?.typeName
  // const fieldType = field && types[fieldTypeName]
  const isUnionTypeType = field.type.src.kind === 'UNION'

  for (let i = 0; i < queryFieldSelections.length; ++i) {
    const querySelection = queryFieldSelections[i]

    if (querySelection.kind === 'InlineFragment' || querySelection.kind === 'FragmentSpread') {
      const fragment = querySelection.kind === 'FragmentSpread'
        ? context.info.fragments[querySelection.name.value]
        : querySelection

      const fragmentFieldTypeName = isUnionTypeType ? fragment.typeCondition.name.value : undefined
      // TODO if !field - shouldn't happen
      const nested = collectNestedQueries({
        context,
        fieldId: createFieldId(field.parent.name, field.name),
        subgraphName,
        path: cpath,
        queryNode,
        querySelection: fragment,
        types,
        fragmentFieldTypeName,
        fields
      })

      // unwrap fragment as selection
      for (const n of nested.queries.values()) {
        queryNode.query.selection.push({
          selection: n.query.selection,
          wrap: fragmentFieldTypeName !== undefined,
          fragment: fragmentFieldTypeName
        })
      }
      collectDeferredQueries(queryNode, nested, deferreds)

      continue
    }

    const selectionFieldName = querySelection.name.value
    // querySelection.kind === 'Field'
    if (selection && !selection.includes(selectionFieldName)) {
      continue
    }

    // meta field, for example `__typename`
    if (selectionFieldName[0] === '_' && selectionFieldName[1] === '_') {
      queryNode.query.selection.push({ field: selectionFieldName })
      continue
    }

    // OLD const selectionField = getSelectionField(fieldType, selectionFieldName)
    // const selectionField = getSelectionField(fields, fieldType, selectionFieldName)
    const fieldId = createFieldId(fieldTypeName, selectionFieldName)
    const selectionField = fields[fieldId]

    const nested = querySelection.selectionSet
    const deferred = !selectionField

    if (deferred) {
      if (context.done.includes(fieldQueryPath)) { continue }

      context.logger.debug(`deferred query for ${cpath} > ${selectionFieldName} on ${subgraphName}`)

      const alias = aliases && aliases[fieldId]
      if (alias && nested) {
        nesting({
          selectionFieldName,
          deferreds,
          context,
          fieldId,
          subgraphName,
          path: cpath,
          queryNode,
          querySelection,
          types,
          fields,
          aliases,
          alias
        })
        continue
      }

      addDeferredQuery({ deferreds, context, subgraphName, path, queryNode, querySelection, field, selectionFieldName, types, fields })
      continue
    }

    if (nested) {
      nesting({
        selectionFieldName,
        deferreds,
        context,
        fieldId,
        subgraphName,
        path: cpath,
        queryNode,
        querySelection,
        types,
        fields,
        aliases
      })
      continue
    }

    // simple field
    queryNode.query.selection.push({ field: selectionFieldName })
  }

  if (queryNode.query.selection.length > 0 || root) {
    context.done.push(fieldQueryPath)
    order.add(fieldQueryPath)
    queries.set(fieldQueryPath, queryNode)
  }

  return { queries, deferreds, order }
}

function nesting ({
  selectionFieldName,
  deferreds,
  context,
  fieldId,
  subgraphName,
  path,
  queryNode,
  querySelection,
  types,
  fields,
  aliases,
  alias
}) {
  const nested = collectNestedQueries({
    context,
    fieldId,
    subgraphName,
    path,
    queryNode,
    querySelection,
    types,
    fields,
    aliases,
    alias
  })

  if (nested.queries.size > 0) {
    queryNode.query.selection.push({ parentField: querySelection.name.value, nested: nested.queries })
  }

  collectDeferredQueries(queryNode, nested, deferreds, selectionFieldName)
}

function collectNestedQueries ({
  context,
  fieldId,
  subgraphName,
  path,
  queryNode,
  querySelection,
  types,
  fields,
  aliases,
  alias,
  fragmentFieldTypeName
}) {
  context.logger.debug({ fieldId, path }, 'query lookup, nested')
  const a = alias ? Object.values(alias)[0] : null

  return collectQueries({
    context,
    subgraphName,
    queryFieldNode: querySelection,
    parent: queryNode,
    path,
    fieldId,
    args: collectNodeArgs(querySelection.arguments, context.info, types),
    types,
    fields,
    aliases,
    typeName: a?.type,
    fragmentFieldTypeName
  })
}

// TODO refactor to better param struct
function addDeferredQuery ({ deferreds, context, path, queryNode, querySelection, field, selectionFieldName = '' }) {
  const fieldName = field?.name ?? queryNode.queryFieldNode.name.value
  const queryPath = pathJoin(path, fieldName, selectionFieldName)

  const deferredParentPath = path + '>' + pathJoin(fieldName, selectionFieldName)
  context.logger.debug('query lookup, add deferred query to get: ' + deferredParentPath)
  // since the selection can't be resolved in the current subgraph,
  // gather information to compose and merge the query later

  let deferred = deferreds.get(deferredParentPath)
  if (!deferred) {
    deferred = createDeferredQuery({
      resolverPath: path,
      fieldPath: queryPath,
      queryNode
    })
    deferreds.set(deferredParentPath, deferred)
  }

  addDeferredQueryField(deferred, selectionFieldName || fieldName, querySelection)
}

function collectDeferredQueries (queryNode, nested, deferreds, selectionFieldName) {
  if (nested.deferreds.size < 1) { return }
  mergeMaps(deferreds, nested.deferreds)
  queryNode.query.selection.push({
    deferreds: nested.deferreds,
    typeName: queryNode.field?.typeName,
    parentFieldName: selectionFieldName
  })
}

function queryPath (cpath, subgraphName) {
  return cpath + '#' + subgraphName
}

module.exports = {
  collectQueries,
  collectNestedQueries
}
