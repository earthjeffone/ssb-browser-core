# SSB browser core

Secure scuttlebutt core (similar to [ssb-server]) in a browser.

This is a full implementation of ssb running in the browser only. The
key of your feed is stored in the browser together with the log,
indexes and smaller images. To reduce storage and network
requirements, partial replication has been implemented. Wasm is used
for crypto and is around 90% the speed of the C implementation. A
WebSocket is used to connect to pubs. The `bundle-core.js` file in
dist/ is roughly 1.5mb.

# api

Once you load the `bundle-core.js` file in a browser a global SSB
object will be available.

The api is not meant to be 100% compatible with regular
ssb-db. Overall there are two major parts: [`db`](#db) and
[`net`](#net).

# config

Loading the bundle-core file as above will use `browser.js`, meaning
default options. It is also possible to overwrite config options,
like:

```
require('../core.js').init(dir, { blobs: { max: 512 * 1024 } })
```

Default config options are defined in `net.js`.

## Runtime configurations

### remoteAddress

The remote server to connect to. Must be web socket.

### validMessageTypes

An
[array](https://github.com/arj03/ssb-browser-core/blob/master/core.js#L94)
of message types to store during sync.

By specifying these, only a subset of messages for feeds are
potentially stored. This means it will not be possible to sync these
feeds to other nodes.

### privateMessages

Check and store private messages during sync. Default is true.

By specifying this to false, only a subset of messages for feeds are
potentially stored. This means it will not be possible to sync these
feeds to other nodes.

### syncOnlyFeedsFollowing

When set, sync will only synchronize feeds you are directly following
instead of all known feeds. Default is false.

### hops

The number of hops from which to receive messages. Default is 1.

## db

### get(id, cb)

Will get a message with `id` from the database. If the message is not
found an err will be returned.

### validateAndAdd(msg, cb)

Validate a raw message (without id and timestamp), checks if the
message is of a known type. Will update profile if applicable. Finally
adds the message to the database and updates the last index. Callback
is the stored message (id, timestamp, value = original message) or
err.

### validateAndAddStrictOrder(msg, cb)

Works the same way as validateAndAdd, except that it doesn't allow
holes, meaning messages added must follow the correct sequence. The
first message for a feed can be at any point.

### add(msg, cb)

Add a raw message (without id and timestamp) to the database. Callback
is the stored message (id, timestamp, value = original message) or
err.

### del(id, cb)

Remove a message from the database. Please note that if you remove a
message for a feed where you store all the messages in the log this
will mean that you won't be able to replicate this feed with other
peers.

### deleteFeed(feedId, cb)

Delete all messages for a particular feed.

Be sure to also call `removeFeedState` to clean up any other state
stored about the feed.

### query

The query index

### last

The last index

### clock

The clock index

### friends

The [ssb-friends] module

### peerInvites

The [ssb-peer-invites] module

### backlinks

The [ssb-backlinks] module

### getStatus

Gets the current db status, same functionality as
[db.status](https://github.com/ssbc/ssb-db#dbstatus) in ssb-db.

## net

This is the [secret-stack] module with a few extra modules
loaded. [ssb-ws] is used to create web socket connections to pubs.

### id

The public key of the current user

### add(msg, cb)

For historical reasons (see ssb-ebt) we have add here. This just calls
`SSB.db.validateAndAdd`.

### rpc:connect event

Example:

```
SSB.net.on('rpc:connect', (rpc) => {
  console.log("connected")
  rpc.on('closed', () => console.log("bye"))
})
```

### blobs

This is where the `blobs` api can be found. The module implements the
blobs protocol and so can exchange blobs with connection peers. It
also contains with the the following extra methods:

#### hash(data, cb)

Hashes data and returns the digest or err

Example:
```
onFileSelect: function(ev) {
  const file = ev.target.files[0]
  file.arrayBuffer().then(function (buffer) {
    SSB.net.blobs.hash(new Uint8Array(buffer), (err, digest) => {
      console.log(digest)
    })
  })
}
```

#### add(blobId, file, cb)

Adds the `file` (such as one obtained from ev.target.files when using
a file select) to the blob store using the blobId name. BlobId is & +
hash.

#### remoteURL(blobId)

Returns a http URL string for the current connection. This is useful
in a browser for images that you don't want to store directly on the
device.

#### privateGet(blobId, unbox, cb)

Callback with err or a url that works for e.g images that was received
in a private message.

#### localGet(blobId, unbox, cb)

If blob already exists will callback with err or a url that can be
used for images for a blob. Otherwise the blob will get requested and
if size is smaller than the maximum size, the blob will be stored
locally and used for callback, otherwise the callback will return a
`remoteURL` link.

### ooo

The [ssb-ooo] module

### tunnelMessage

Uses a modified version of [ssb-tunnel] to send and receive end-to-end
encrypted ephemeral messages between two peers.

#### acceptMessages(confirmHandler)

Tell the pub to allow incoming connections, but call confirmHandler
with the remote feedId for manual confirmation.

#### connect(feedId, cb)

Connect to a remote feedId. When connected a message will be put in
`messages`. Takes an optional cb.

#### disconnect()

Disconnects all currently active tunnel connections.

#### sendMessage(type, data)

Send a data message to the remote user, adds the message to the local `messages` stream.

#### messages

A stream of messages consisting of type, user and data. Example usage:

```
pull(
  messages(),
  pull.drain((msg) => {
    console.log(msg.user + "> " + msg.data)
  })
)
```

### Browser specific methods on net

For partial replication a special plugin has been created, the pub
needs to have the plugin installed:

- [ssb-partial-replication]

Once a rpc connection has been established, a few extra methods are
available under SSB.net.partialReplication. See plugin for
documentation.

## SSB

Other things directly on the global SSB object

### dir

The path to where the database and blobs are stored.

### validate

The [ssb-validate] module.

### state

The current [state](https://github.com/ssbc/ssb-validate#state) of
known feeds.

### connected(cb)

If not connected, will connect and return. If connected, will just
return the already present rpc connection. Cb signature is (err, rpc).

### removeFeedState(feedId)

Remove any state related to feed. This complements `db.deleteFeed`
that removes the users messages from the local database.

### profiles

A dict from feedId to { name, description, image }

#### loadProfiles()

Populates profiles dict from localStorage

#### saveProfiles

Save the profiles dict in localStorage

### publish(msg, cb)

Validates a message and stores it in the database. See db.add for format.

### messagesByType

A convenience method around db.query to get messages of a particular type.

### sync()

Start a EBT replication with the remote server. This syncs all the
feeds known in `SSB.state.feeds`, unless `syncOnlyFeedsFollowing` is
set, in which case only feeds you are following directly are
synced. Compared to a normal SSB distribution this corresponds to hops
1. There is currently no concept of blocked feeds. There is the option
of removing feeds.

This uses `validMessageTypes` and `privateMessages` to determine what
gets stored locally.

### box

[box](https://github.com/ssbc/ssb-keys#boxcontent-recipients--boxed)
method from ssb-keys. Useful for private messages.

### blobFiles

The [ssb-blob-files] module.

### SSB: loaded event

Because loading wasm is async, an event will be fired when `SSB` is
ready to use. Example:

```
SSB.events.on('SSB: loaded', function() {
  console.log("ready to rock!")
})
```

&nbsp;
&nbsp;

There are a few other undocumented methods, these will probably be
moved to another module in a later version as they are quite tied to
[ssb-browser-demo].

# Browser compatibility

Tested with Chrome and Firefox. Chrome is faster because it uses fs
instead of indexeddb. Also tested on android using Chrome and iOS
using safari.

# Building

The following patches (patch -p0 < x.patch) from the patches folder
are needed:
 - epidemic-broadcast-fix-replicate-multiple.patch
 - ssb-ebt.patch
 - ssb-friends.patch
 - ssb-tunnel.patch
 - ssb-peer-invites.patch
 - ssb-blob-files.patch

The following branches are references directly until patches are merged and pushed:
 - https://github.com/ssbc/ssb-validate/pull/16

For a smaller bundle file, you can also apply
patches/sodium-browserify.patch

[ssb-server]: https://github.com/ssbc/ssb-server
[ssb-browser-demo]: https://github.com/arj03/ssb-browser-demo
[secret-stack]: https://github.com/ssbc/secret-stack
[ssb-ws]: https://github.com/ssbc/ssb-ws
[ssb-friends]: https://github.com/ssbc/ssb-friends
[ssb-peer-invites]: https://github.com/ssbc/ssb-peer-invites
[ssb-backlinks]: https://github.com/ssbc/ssb-backlinks
[ssb-validate]: https://github.com/ssbc/ssb-validate
[ssb-blob-files]: https://github.com/ssbc/ssb-blob-files
[ssb-ooo]: https://github.com/ssbc/ssb-ooo
[ssb-tunnel]: https://github.com/ssbc/ssb-tunnel

[ssb-get-thread]: https://github.com/arj03/ssb-get-thread
[ssb-partial-replication]: https://github.com/arj03/ssb-partial-replication
