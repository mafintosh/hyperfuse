#define FUSE_USE_VERSION 29
#define HYPEROS_GETATTR 1

#include <fuse.h>
#include <fuse_opt.h>
#include <fuse_lowlevel.h>
#include <stdio.h>
#include <stdlib.h>
#include <sys/mount.h>
#include <sys/stat.h>
#include <string.h>

#include "socket.h"
#include "enc.h"
#include "id_map.h"

#include <unistd.h>

static int rpc_fd;
static id_map_t ids;
static struct stat mnt_st;

typedef struct {
  uint8_t method;
  void *result;
  char *buffer;
  uint32_t buffer_length;
} rpc_t;

inline static int rpc_request (rpc_t *req) {
  char *tmp = req->buffer;
  uint16_t send_id = id_map_alloc(&ids, req);

  // write header
  tmp = write_uint32(tmp, req->buffer_length - 4);
  tmp = write_uint16(tmp, send_id);
  tmp = write_uint8(tmp, req->method);

  // write request
  if (socket_write(rpc_fd, req->buffer, req->buffer_length) < 0) return -1;

  // read a response
  char header[10];
  tmp = (char *) &header;
  if (socket_read(rpc_fd, tmp, 10) < 0) return -1;

  uint32_t frame_size;
  uint16_t recv_id;
  int32_t ret;

  tmp = read_uint32(tmp, &frame_size);
  tmp = read_uint16(tmp, &recv_id);
  tmp = read_int32(tmp, &ret);

  printf("frame_size is %u\n", frame_size);
  printf("recv_id is %u\n", recv_id);
  printf("return value is %u\n", ret);

  id_map_free(&ids, send_id);

  char rem[frame_size - 6];
  tmp = (char *) &rem;
  if (socket_read(rpc_fd, tmp, frame_size - 6) < 0) return -1;

  uint32_t val_32;

  if (ret < 0) return ret;

  switch (req->method) {
    case HYPEROS_GETATTR: {
      struct stat *st = (struct stat *) req->result;
      tmp = read_uint32(tmp, &val_32);
      st->st_dev = val_32;
      tmp = read_uint32(tmp, &val_32);
      st->st_mode = val_32;
      tmp = read_uint32(tmp, &val_32);
      st->st_nlink = val_32;
      tmp = read_uint32(tmp, &val_32);
      st->st_uid = val_32;
      tmp = read_uint32(tmp, &val_32);
      st->st_gid = val_32;
      tmp = read_uint32(tmp, &val_32);
      st->st_rdev = val_32;
      tmp = read_uint32(tmp, &val_32);
      st->st_blksize = val_32;
      tmp = read_uint32(tmp, &val_32);
      st->st_ino = val_32;
      tmp = read_uint32(tmp, &val_32);
      st->st_size = val_32;
      tmp = read_uint32(tmp, &val_32);
      st->st_blocks = val_32;
      tmp = read_uint32(tmp, &val_32);
      st->st_atimespec.tv_sec = val_32;
      tmp = read_uint32(tmp, &val_32);
      st->st_mtimespec.tv_sec = val_32;
      tmp = read_uint32(tmp, &val_32);
      st->st_ctimespec.tv_sec = val_32;
      break;
    }
  }

  printf("her nu\n");

  return 0;
}

static int hyperos_getattr (const char *path, struct stat *st) {
  if (!strcmp(path, "/")) {
    memcpy(st, &mnt_st, sizeof(struct stat));
    return 0;
  }

  uint16_t path_len = strlen(path);
  uint32_t buf_len = 7 + 2 + path_len;
  char buf[buf_len];

  rpc_t req = {
    .method = HYPEROS_GETATTR,
    .result = st,
    .buffer = buf,
    .buffer_length = buf_len
  };

  write_string(buf + 7, (char *) path, path_len);
  return rpc_request(&req);
}

static int hyperos_readdir (const char *path, void *buf, fuse_fill_dir_t filler, off_t offset, struct fuse_file_info *info) {
  struct stat empty_stat;
  int ret = filler(buf, "test-test", &empty_stat, 0);
  return 0;
}

int main (int argc, char **argv) {
  char *mnt = "./mnt";
  unmount(mnt, 0);

  if (stat(mnt, &mnt_st) < 0) {
    printf("Mountpoint does not exist\n");
    return -1;
  }

  rpc_fd = socket_connect(10000, NULL);
  if (rpc_fd < 0) {
    printf("Could not connect to server\n");
    return -2;
  }

  id_map_init(&ids);

  struct fuse_operations ops = {
    .readdir = hyperos_readdir,
    .getattr = hyperos_getattr
  };

  struct fuse_args args = FUSE_ARGS_INIT(argc, argv);
  struct fuse_chan *ch = fuse_mount(mnt, &args);

  if (ch == NULL) {
    printf("Could not mount fuse\n");
    return -3;
  }

  struct fuse *fuse = fuse_new(ch, &args, &ops, sizeof(struct fuse_operations), NULL);

  if (fuse == NULL) {
    printf("Could not instantiate fuse\n");
    return -4;
  }

  fuse_loop(fuse);
  fuse_unmount(mnt, ch);
  fuse_session_remove_chan(ch);
  fuse_destroy(fuse);

  printf("KTHXBYE\n");

  return 0;
}
