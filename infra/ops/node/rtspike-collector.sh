#!/bin/sh
# Збирач метрик спайку П-RT: кожні N секунд дописує один рядок JSON у файл (JSONL).
#   sh rtspike-collector.sh <файл.jsonl> [секунди=10] [контейнер centrifugo або порожньо]
# Хост: CPU (з /proc/stat, частка зайнятого між тактами), RAM (/proc/meminfo), сокети (/proc/net/sockstat);
# контейнери: `docker stats --no-stream`; Centrifugo: ключові ряди /metrics із внутрішнього порту 9000 (через docker exec).
# Працює на вузлі (dash) і в контейнері docker:cli (busybox) з pid/network хоста. Секретів не читає й не пише.
set -u
OUT="${1:?файл виводу}"
EVERY="${2:-10}"
CENT="${3:-}"

cpu_sample() { awk '/^cpu /{ idle=$5+$6; tot=0; for(i=2;i<=NF;i++) tot+=$i; print tot, idle; exit }' /proc/stat; }

set -- $(cpu_sample)
PREV_TOT=$1
PREV_IDLE=$2

while :; do
  sleep "$EVERY"
  set -- $(cpu_sample)
  TOT=$1
  IDLE=$2
  CPU=$(awk -v t="$TOT" -v pt="$PREV_TOT" -v i="$IDLE" -v pi="$PREV_IDLE" 'BEGIN{ d=t-pt; if (d<=0) print 0; else printf "%.1f", 100*(1-(i-pi)/d) }')
  PREV_TOT=$TOT
  PREV_IDLE=$IDLE
  NCPU=$(grep -c '^processor' /proc/cpuinfo)
  MEM=$(awk '/^MemTotal:/{t=$2} /^MemAvailable:/{a=$2} END{ printf "\"mem_total_mb\":%d,\"mem_used_mb\":%d", t/1024, (t-a)/1024 }' /proc/meminfo)
  LOAD=$(awk '{print $1}' /proc/loadavg)
  SOCK=$(awk '/^TCP:/{ for(i=2;i<NF;i+=2) printf "%s\"tcp_%s\":%s", (n++?",":""), $i, $(i+1) }' /proc/net/sockstat)
  STATS=$(docker stats --no-stream --format '{{.Name}}|{{.CPUPerc}}|{{.MemUsage}}|{{.NetIO}}' 2>/dev/null |
    awk -F'|' '{ gsub(/%/,"",$2); split($3,m," / "); split($4,n," / ");
      printf "%s{\"name\":\"%s\",\"cpu_pct\":%s,\"mem\":\"%s\",\"net_in\":\"%s\",\"net_out\":\"%s\"}", (c++?",":""), $1, ($2==""?0:$2), m[1], n[1], n[2] }')
  CM=''
  if [ -n "$CENT" ]; then
    CM=$(docker exec "$CENT" wget -qO- http://127.0.0.1:9000/metrics 2>/dev/null |
      awk '/^centrifugo_/ {
        name=$1; sub(/\{.*/, "", name); v=$NF;
        if (name ~ /(num_clients|num_subscriptions|num_channels|num_users|messages_sent|messages_received|broker|redis|publish|disconnect|connections|pub_sub_lag|reply_errors|command_duration_seconds_count)/) {
          s[name]+=v
          if (name ~ /disconnect/ && match($1, /code="[0-9]+"/)) { code=substr($1, RSTART+6, RLENGTH-7); d[code]+=v }
        }
      }
      END {
        for (k in s) printf "%s\"%s\":%.0f", (c++?",":""), k, s[k];
        printf "%s\"disconnect_by_code\":{", (c++?",":"");
        for (k in d) printf "%s\"%s\":%.0f", (e++?",":""), k, d[k];
        printf "}"
      }')
  fi
  printf '{"ts":%s,"cpu_pct":%s,"ncpu":%s,"load1":%s,%s,"sock":{%s},"containers":[%s],"centrifugo":{%s}}\n' \
    "$(date +%s)" "$CPU" "$NCPU" "$LOAD" "$MEM" "$SOCK" "$STATS" "$CM" >> "$OUT"
done
