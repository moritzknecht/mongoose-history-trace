'use strict'

const { HistoryLogModel } = require('./historyLog-model')
const DeepDiff = require('./helper-diff')
const { isEmpty, get, assign } = require('lodash')
const ACTIONS = { updated: 'Edited Document', deleted: 'Removed Document', created: 'Created Document' }

/**
 *
 * @param { mongoose } schema - schema mongoose
 * @param { Object } options
 * {
 *   customCollectionName: String             //default is collection name
 *   connectionUri: String             //default is connection of collection
 *   moduleName: String                       //default is collection name
 *   indexes: [
 *        {'path': 1},                        //paths create index on history log collection
 *        {'path': -1},
 *        {'path': 'text'}
 *   ]
 *   omitPaths: ['_id', '__v']                //paths omit on created history log
 *   addCollectionPaths: [                    //add paths in collection history log
 *      {key: 'path1', value: 'String' },     //    key - name path
 *      {key: 'path2', value: 'String' },     //    value - mongoose types .('ObjectId', 'Mixed', 'String', 'Number', etc)
 *      {key: 'path3.path2',                  //    sudoc : {key: 'field.subdoc', value: 'String'}
 *          value: 'ObjectId' },
 *   ]
 *
 * }
 */
function HistoryPlugin(schema, options= {}) {
    schema.statics.historyModel = function() {
        return HistoryLogModel(options)
    }

    schema.pre('save', function (next) {
        _processPreSave.call(this, next, options)
    })

    schema.pre(/update|updateOne|findOneAndUpdate|findByIdAndUpdate/, function (next) {
        _processPreUpdate.call(this, next, options)
    })

    schema.pre(/deleteOne|remove/, function (next) {
        _processPreRemove.call(this, next, options)
    })

    schema.pre(/deleteMany/, function (next) {
        _processRemoveMany.call(this, next, options)
    })

    schema.post(/findOneAndRemove|remove/, function (doc, next) {
        _processPosRemove.call(this, doc, next, options)
    })
}

/**
 * @author Welington Monteiro
 * @param json
 * @return {{}|any}
 * @private
 */
function _toJSON(json) {
    if (isEmpty(json)) return {}
    return JSON.parse(JSON.stringify(json))
}

/**
 * @author Welington Monteiro
 * @param { Array } doc - doc
 * @param { Object } options
 * @return {{documentNumber: String, module: String, changes: Array, action: *, operation: String}}
 */
function _mappedFieldsLog(doc = {},  options) {
    const { changes, module, documentNumber, method } = doc
    const action = ACTIONS[method]

    return { changes, action, module, documentNumber, method }
}

/**
 *@author Welington Monteiro
 * @param object
 * @param next
 * @param options
 */
async function _saveHistoryLog(object, next, options) {
    if (isEmpty(get(object, 'changes'))) {
        console.error('No changes generated document.')
        return await next()
    }
    const HistoryLog = HistoryLogModel(options)
    const history = new HistoryLog(object)
    history.save(next)
}

/**
 * @author Welington Monteiro
 * @param object
 * @param query
 * @param method
 * @param next
 * @return {*}
 */
function validation({ object, query, method },next) {
    if (isEmpty(object) || isEmpty(query)) {
        console.error(`Not found documents to ${method} history logs.`)
        return next()
    }
}

/**
 * @author Welington Monteiro
 * @param next
 * @param options
 * @return {Promise<*>}
 */
async function _processPreUpdate(next, options) {
    const query = get(this, '_conditions')
    const old = _toJSON(await this.findOne(query))
    const module = get(options, 'moduleName', get(this, 'mongooseCollection.name'))
    const mod = _toJSON(get(this, '_update.$set', get(this, '_update')))
    const documentNumber = get(old, '_id')
    const method = 'updated'

    validation({ object: old, query, method },next)

    const current = assign({}, old, mod)
    const changes = DeepDiff.getDiff({ old, current }, options)
    const docMapped = _mappedFieldsLog({ changes, method, module, documentNumber }, options)

    await _saveHistoryLog(docMapped, next, options)
}

/**
 * @author Welington Monteiro
 * @param next
 * @param options
 * @return {Promise<void>}
 * @private
 */
async function _processRemoveMany(next, options){
    const query = get(this, '_conditions')
    const olds = _toJSON(await this.find(query))
    olds.map((eachOld) => _processPosRemove(eachOld, next, options))
}

/**
 * @author Welington Monteiro
 * @param next
 * @param options
 * @return {Promise<*>}
 * @private
 */
async function _processPreRemove (next, options) {
    const query = get(this, '_conditions')
    const old = _toJSON(await this.findOne(query))

    await _processPosRemove(old, next, options)
}

/**
 * @author Welington Monteiro
 * @param next
 * @param options
 * @return {Promise<void>}
 * @private
 */
async function _processPreSave(next, options) {
    const module = get(options, 'moduleName', get(this, 'collection.name'))
    const method = get(this, 'isNew') ? 'created' : 'updated'
    const current = _toJSON(this.toObject())
    const documentNumber = get(current, '_id')
    const old = _toJSON(get(this, '_original', {}))
    let changes = []

    if (this.isNew) changes = DeepDiff.getDiff({ current }, options)

    if (!this.isNew) changes = DeepDiff.getDiff({ old, current }, options)

    const docMapped = _mappedFieldsLog({ changes, method, module, documentNumber }, options)
    await _saveHistoryLog(docMapped, next, options)
}

/**
 * @author Welington Monteiro
 * @param doc
 * @param next
 * @param options
 * @return {Promise<void>}
 */
async function _processPosRemove(doc, next, options) {
    const old = _toJSON(doc.toObject())
    const module = get(options, 'moduleName', get(this, 'collection.name'))
    const method = 'deleted'
    const documentNumber = get(old, '_id')
    const changes = DeepDiff.getDiff({ old }, options)

    const docMapped = _mappedFieldsLog({ changes, method, module, documentNumber }, options)

    await _saveHistoryLog(docMapped, next, options)
}


module.exports = HistoryPlugin