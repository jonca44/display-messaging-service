gcloud compute --project "display-messaging-service" instance-groups managed create "instance-group-messaging-service" --zone "us-central1-c" --base-instance-name "instance-group-messaging-service" --template "instance-template-messaging-service" --size "1"