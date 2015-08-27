var fs = require('fs')
var rfuse = require('./')
var proc = require('child_process')
var join = require('path').join
var resolve = require('path').resolve

var from = resolve('tmp')

var stream = rfuse({
  unlink: function (path, cb) {
    console.error('unlink', path)
    fs.unlink(join(from, path), cb)
  },
  create: function (path, mode, cb) {
    console.error('create', path, mode)
    fs.open(join(from, path), 'w', cb)
  },
  open: function (path, mode, cb) {
    console.error('open', path, mode)
    fs.open(join(from, path), mode, cb)
  },
  truncate: function (path, size, cb) {
    console.error('truncate', path, size)
    fs.truncate(join(from, path), size, cb)
  },
  read: function (path, fd, buffer, len, pos, cb) {
    console.error('read', path, fd, len, pos)
    fs.read(fd, buffer, 0, len, pos, cb)
  },
  write: function (path, fd, buffer, len, pos, cb) {
    console.error('write', path, fd, len, pos)
    fs.write(fd, buffer, 0, len, pos, cb)
  },
  readdir: function (path, cb) {
    console.error('readdir', path)
    fs.readdir(join(from, path), cb)
  },
  getattr: function (path, cb) {
    console.error('getattr', path)
    fs.lstat(join(from, path), cb)
  },
  chmod: function (path, mode, cb) {
    console.error('chmod', path, mode)
    fs.chmod(join(from, path), mode, cb)
  },
  chown: function (path, uid, gid, cb) {
    console.error('chown', path, uid, gid)
    fs.chown(join(from, path), uid, gid, cb)
  },
  release: function (path, fd, cb) {
    console.error('release', path, fd)
    fs.close(fd, cb)
  },
  mkdir: function (path, mode, cb) {
    console.error('mkdir', path, mode)
    fs.mkdir(join(from, path), mode, cb)
  },
  rmdir: function (path, cb) {
    console.error('rmdir', path)
    fs.rmdir(join(from, path), cb)
  },
  utimens: function (path, atime, mtime, cb) {
    console.error('utimens', path, atime, mtime)
    fs.utimes(join(from, path), atime, mtime, cb)
  },
  rename: function (path, dst, cb) {
    console.error('rename', path, dst)
    fs.rename(join(from, path), join(from, dst), cb)
  },
  symlink: function (src, dst, cb) {
    console.error('symlink', src, dst)
    fs.symlink(src, join(from, dst), cb)
  },
  readlink: function (path, cb) {
    console.error('readlink', path)
    fs.readlink(join(from, path), function (err, link) {
      if (err) return cb(err)
      if (link === from || link.indexOf(from + '/') === 0) link = link.replace(from, stream.path)
      cb(0, link)
    })
  },
  link: function (src, dst, cb) {
    console.error('link', src, dst)
    fs.link(join(from, src), join(from, dst), cb)
  }
})

stream.on('mount', function (mnt) {
  console.error('fuse mounted on', mnt)
})

var child = proc.spawn('./hyperfuse', ['mnt', '-'])
child.stdout.pipe(stream).pipe(child.stdin)
child.stderr.pipe(process.stderr)
