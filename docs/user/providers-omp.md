# OMP

T3 Code runs [Oh My Pi](https://github.com/can1357/oh-my-pi) (`omp`) through `omp acp`, keeping
OMP's models, settings, skills, extensions, and sign-in under `~/.omp`.

## Set up OMP

1. Install OMP on the machine running the T3 Code server and sign in to a model provider with
   `omp login`.
2. Open **Settings → Providers** and enable OMP.

If `omp` is not on the server's `PATH`, set its **Binary path**. T3 Code adds the `acp` argument
itself; **Launch arguments** follow it.

## What carries over

Models, thinking level, and OMP's Default and Plan modes come from OMP. Send `/compact`, or use
**Compact** from the context meter, to run OMP's compaction. OMP reports when a conversation is
too short to compact. The context meter and cost follow OMP's usage reports.
