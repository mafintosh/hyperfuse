DEPS = src/enc.c src/id_map.c src/socket.c
FUSE_OPTS = $(shell pkg-config --libs-only-L --libs-only-l fuse --cflags-only-I)-D_FILE_OFFSET_BITS=64
CC = gcc -std=c99

all: hyperfuse

hyperfuse: $(DEPS) src/hyperfuse.c
	$(CC) -O3 -pthread $^ $(FUSE_OPTS) -o $@

test: $(DEPS) tests/*.c
	$(CC) $^ $(FUSE_OPTS) -o $@
	./$@

clean:
	rm -f test hyperfuse

.PHONY: test
