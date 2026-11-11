# PravahOS Hermetic Reproducible Build Container
# Target: Google Pixel 7 ("panther" - Tensor G2 / GS201)
# Foundation 1: AOSP GKI Linux 5.10 + Native pravahd daemon

FROM ubuntu:22.04

ENV DEBIAN_FRONTEND=noninteractive
ENV LANG=C.UTF-8

# Install pinned host build dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    clang \
    lld \
    llvm \
    gcc-aarch64-linux-gnu \
    g++-aarch64-linux-gnu \
    libc6-dev-arm64-cross \
    bison \
    flex \
    libssl-dev \
    libelf-dev \
    bc \
    git \
    git-lfs \
    python3 \
    python3-pip \
    python3-setuptools \
    curl \
    rsync \
    ninja-build \
    cpio \
    kmod \
    ca-certificates \
    nodejs \
    npm \
    fastboot \
    android-tools-adb \
    && rm -rf /var/lib/apt/lists/*

# Install repo tool for Android source sync
RUN curl -o /usr/local/bin/repo https://storage.googleapis.com/git-repo-downloads/repo \
    && chmod a+rx /usr/local/bin/repo

# Create build workspace and non-root builder user
RUN useradd -m -u 1000 pravahbuilder
WORKDIR /workspace
RUN chown -R pravahbuilder:pravahbuilder /workspace

USER pravahbuilder

# Copy build scripts into image
COPY --chown=pravahbuilder:pravahbuilder . /workspace/pravah_source

CMD ["/bin/bash"]
