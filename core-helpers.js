const validate = require('ssb-validate')
const keys = require('ssb-keys')
const pull = require('pull-stream')
const raf = require('polyraf')

var remote

exports.connected = function(cb)
{
  if (!remote || remote.closed)
  {
    SSB.isInitialSync = false // for ssb-ebt
    SSB.net.connect(SSB.remoteAddress, (err, rpc) => {
      if (err) throw(err)

      remote = rpc
      cb(remote)
    })
  } else
    cb(remote)
}

exports.removeDB = function() {
  const path = require('path')

  const file = raf(path.join(SSB.dir, 'log.offset'))
  file.open((err, done) => {
    if (err) return console.error(err)
    file.destroy()
  })

  localStorage['last.json'] = JSON.stringify({})
  localStorage['profiles.json'] = JSON.stringify({})

  console.log("remember to delete indexdb indexes as well!")
}

exports.removeBlobs = function() {
  function listDir(fs, path)
  {
    fs.root.getDirectory(path, {}, function(dirEntry) {
      var dirReader = dirEntry.createReader()
      dirReader.readEntries(function(entries) {
	for(var i = 0; i < entries.length; i++) {
	  var entry = entries[i]
	  if (entry.isDirectory) {
	    //console.log('Directory: ' + entry.fullPath);
	    listDir(fs, entry.fullPath)
	  }
	  else if (entry.isFile) {
            console.log('deleting file: ' + entry.fullPath)
            const file = raf(entry.fullPath)
            file.open((err, done) => {
              if (err) return console.error(err)
              file.destroy()
            })
          }
	}
      })
    })
  }

  window.webkitRequestFileSystem(window.PERSISTENT, 0, function (fs) {
    listDir(fs, '/.ssb-lite/blobs')
  })
}

exports.sync = function()
{
  exports.connected((rpc) => {
    if (!SSB.state.feeds[SSB.net.id])
      SSB.net.replicate.request(SSB.net.id, true)

    if (SSB.syncOnlyFeedsFollowing) {
      SSB.db.friends.hops((err, hops) => {
        for (var feed in hops)
          if (hops[feed] == 1)
            SSB.net.replicate.request(feed, true)
      })
    } else {
      for (var feed in SSB.state.feeds)
        SSB.net.replicate.request(feed, true)
    }
  })
}

function writeOnboardProfiles(onboard)
{
  let cleaned = {}
  for (var key in onboard) {
    cleaned[key] = {
      image: onboard[key].image,
      name: onboard[key].name,
      description: onboard[key].description
    }
  }

  // merge in user updates
  for (var author in SSB.profiles) {
    Object.assign(cleaned[author], SSB.profiles[author])
  }

  localStorage['profiles.json'] = JSON.stringify(cleaned)

  SSB.profiles = cleaned
}

exports.saveProfiles = function() {
  localStorage['profiles.json'] = JSON.stringify(SSB.profiles)
}

exports.loadProfiles = function() {
  if (localStorage['profiles.json'])
    SSB.profiles = JSON.parse(localStorage['profiles.json'])
}

exports.initialSync = function(onboard)
{
  SSB.isInitialSync = true // for ssb-ebt
  SSB.net.connect(SSB.remoteAddress, (err, rpc) => {
    if (err) throw(err)

    var d = new Date()
    var onemonthsago = d.setMonth(d.getMonth() - 1)

    var totalMessages = 0
    var totalFilteredMessages = 0
    var totalPrivateMessages = 0
    var totalFeeds = 0

    console.time("downloading messages")

    function getMessagesForUser(index)
    {
      if (index >= Object.keys(onboard).length) {
        console.log("feeds", totalFeeds)
        console.log("messages", totalMessages)
        console.log("filtered", totalFilteredMessages)
        console.timeEnd("downloading messages")

        SSB.isInitialSync = false
        writeOnboardProfiles(onboard)

        return
      }

      var user = Object.keys(onboard)[index]

      // FIXME: filter out in script
      if (onboard[user].latestMsg == null) {
        getMessagesForUser(index+1)
        return
      }

      if (onboard[user].latestMsg.timestamp < onemonthsago && user != SSB.net.id) {
        //console.log("skipping older posts for", onboard[user].name)
        getMessagesForUser(index+1)
        return
      }

      var seqStart = onboard[user].latestMsg.seq - 25
      if (seqStart < 0)
        seqStart = 0

      if (user == SSB.net.id) // always all
        seqStart = 0
      else
        SSB.db.last.setPartialLogState(user, true)

      ++totalFeeds

      //console.log(`Downloading messages for: ${onboard[user].name}, seq: ${seqStart}`)

      pull(
        rpc.partialReplication.partialReplication({ id: user, seq: seqStart, keys: false }),
        pull.asyncMap((msg, cb) => {
          ++totalMessages
          SSB.net.add(msg, (err, res) => {
            if (res)
              ++totalFilteredMessages

            cb(err, res)
          })
        }),
        pull.collect((err) => {
          if (err) throw err

          SSB.state.queue = []

          getMessagesForUser(index+1)
        })
      )
    }

    getMessagesForUser(0)
  })
}
