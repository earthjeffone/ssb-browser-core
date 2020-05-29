const Store = require('./store')
const pull = require('pull-stream')

const hash = require('ssb-keys/util').hash
const validate = require('ssb-validate')
const keys = require('ssb-keys')

function getId(msg) {
  return '%'+hash(JSON.stringify(msg, null, 2))
}

exports.init = function (dir, net, config) {
  const store = Store(dir, net.id, net.auth, net.replicate, config)

  function get(id, cb) {
    store.keys.get(id, (err, data) => {
      if (data)
	cb(null, data.value)
      else
	cb(err)
    })
  }

  function add(msg, cb) {
    var id = getId(msg)

    if (store.since.value == 0 || SSB.isInitialSync)
    {
      // empty db, keys.get will block, just add anyways
      store.add(id, msg, cb)
    }
    else
    {
      store.keys.get(id, (err, data) => {
	if (data)
	  cb(null, data.value)
	else
	  store.add(id, msg, cb)
      })
    }
  }

  function decryptMessage(msg) {
    return keys.unbox(msg.content, SSB.net.config.keys.private)
  }

  const hmac_key = null

  function updateProfile(msg) {
    if (!SSB.profiles)
      SSB.profiles = {}
    if (!SSB.profiles[msg.author])
      SSB.profiles[msg.author] = {}

    if (msg.content.name)
      SSB.profiles[msg.author].name = msg.content.name
    if (msg.content.description)
      SSB.profiles[msg.author].description = msg.content.description

    if (msg.content.image && typeof msg.content.image.link === 'string')
      SSB.profiles[msg.author].image = msg.content.image.link
    else if (typeof msg.content.image === 'string')
      SSB.profiles[msg.author].image = msg.content.image
  }

  function addMsg(updateLast, skippingMessages, msg, cb) {
    if (updateLast)
      store.last.update(msg)

    var ok = true

    var isPrivate = (typeof (msg.content) === 'string')

    if (isPrivate && !SSB.privateMessages) {
      ok = false
    } else if (!isPrivate && msg.content.type == 'about' && msg.content.about == msg.author) {
      updateProfile(msg)
    } else if (!isPrivate && !SSB.validMessageTypes.includes(msg.content.type)) {
      ok = false
    } else if (isPrivate) {
      var decrypted = decryptMessage(msg)
      if (!decrypted) // not for us
        ok = false
    }

    if (ok) {
      add(msg, cb)

      if (skippingMessages)
        store.last.setPartialLogState(msg.author, true)
    }
    else
    {
      if (updateLast)
        store.last.setPartialLogState(msg.author, true)
      cb()
    }
  }

  function validateAndAddStrictOrder(msg, cb) {
    const knownAuthor = msg.author in SSB.state.feeds

    try {
      if (!knownAuthor)
        SSB.state = validate.appendOOO(SSB.state, hmac_key, msg)
      else
        SSB.state = validate.append(SSB.state, hmac_key, msg)

      if (SSB.state.error)
        return cb(SSB.state.error)

      addMsg(true, false, msg, cb)
    }
    catch (ex)
    {
      return cb(ex)
    }
  }

  function validateAndAdd(msg, cb) {
    const knownAuthor = msg.author in SSB.state.feeds
    const earlierMessage = knownAuthor && msg.sequence < SSB.state.feeds[msg.author].sequence
    const skippingMessages = knownAuthor && msg.sequence > SSB.state.feeds[msg.author].sequence + 1

    const alreadyChecked = knownAuthor && msg.sequence == SSB.state.feeds[msg.author].sequence
    if (alreadyChecked && cb)
      return cb()

    if (!knownAuthor || earlierMessage || skippingMessages)
      SSB.state = validate.appendOOO(SSB.state, hmac_key, msg)
    else
      SSB.state = validate.append(SSB.state, hmac_key, msg)

    if (SSB.state.error)
      return cb(SSB.state.error)

    const updateLast = !earlierMessage

    addMsg(updateLast, skippingMessages, msg, cb)
  }

  function deleteFeed(feedId, cb) {
    pull(
      store.query.read({
        query: [{
          $filter: {
            value: {
              author: feedId
            }
          }
        }]
      }),
      pull.asyncMap((msg, cb) => {
        store.del(msg.key, (err) => {
          cb(err, msg.key)
        })
      }),
      pull.collect(cb)
    )
  }
  
  return {
    get,
    add,
    validateAndAdd,
    validateAndAddStrictOrder,
    del: store.del,
    deleteFeed,
    // indexes
    backlinks: store.backlinks,
    query: store.query,
    last: store.last,
    clock: store.clock,
    friends: store.friends,
    peerInvites: store['peer-invites'],
    getStatus: store.getStatus
  }
}
