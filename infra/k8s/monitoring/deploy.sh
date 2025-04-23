#!/bin/bash

# Exit immediately if a command exits with a non-zero status
set -e

# Create the namespace first
kubectl apply -f namespace.yaml

# Create the ConfigMaps and Secrets
kubectl apply -f prometheus-configmap.yaml
kubectl apply -f grafana-datasources.yaml
kubectl apply -f grafana-dashboards.yaml
kubectl apply -f grafana-secrets.yaml

# Create the Deployments
kubectl apply -f prometheus-deployment.yaml
kubectl apply -f grafana-deployment.yaml

# Create the Services
kubectl apply -f prometheus-service.yaml
kubectl apply -f grafana-service.yaml

echo "Monitoring stack deployed successfully!"
echo "Access Prometheus at: http://localhost:9090 (after port-forwarding)"
echo "Access Grafana at: http://localhost:3000 (after port-forwarding)"
echo ""
echo "Port forwarding commands:"
echo "kubectl port-forward svc/prometheus 9090:9090 -n monitoring"
echo "kubectl port-forward svc/grafana 3000:3000 -n monitoring" 