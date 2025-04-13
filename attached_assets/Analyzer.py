import os
import re
import json
from collections import defaultdict

log_file_path = 'Sample_logs/auth.log'
report_dir = 'reports'
report_file = os.path.join(report_dir, 'summary.json')

if not os.path.exists(report_dir):
    os.makedirs(report_dir)

# Regex to match: Date, User (valid/invalid), IP and Port
pattern = r'^(\w{3} \d{1,2} \d{2}:\d{2}:\d{2}) .*sshd.*Failed password for (invalid user )?(\w+) from ([\d.]+) port (\d+)'

failed_attempts = []
ip_summary = defaultdict(lambda: {
    "attempts": 0,
    "users": set(),
    "timestamps": []
})

# Read log file and analyze
with open(log_file_path, 'r') as file:
    for line in file:
        match = re.search(pattern, line)
        if match:
            timestamp = match.group(1)
            user = match.group(3)
            ip = match.group(4)

            # Store individual failed attempt
            failed_attempts.append({
                "timestamp": timestamp,
                "user": user,
                "ip": ip,
                "raw": line.strip()
            })

            # Update summary per IP
            ip_summary[ip]["attempts"] += 1
            ip_summary[ip]["users"].add(user)
            ip_summary[ip]["timestamps"].append(timestamp)

# Convert sets to lists for JSON serialization
for ip in ip_summary:
    ip_summary[ip]["users"] = list(ip_summary[ip]["users"])

# Save detailed report
report_data = {
    "total_failed_attempts": len(failed_attempts),
    "ip_summary": dict(ip_summary),
    "logs": failed_attempts
}

with open(report_file, 'w') as outfile:
    json.dump(report_data, outfile, indent=4)

print(f"[+] Analysis complete. {len(failed_attempts)} failed attempts analyzed.")
print(f"[+] Unique IPs involved: {len(ip_summary)}")
print(f"[+] Report saved to {report_file}")
