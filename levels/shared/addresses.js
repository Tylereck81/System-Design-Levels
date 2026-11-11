// @ts-check
// Placeholder IP addresses the levels show, so every message, lesson and diagram names the same machines.
// The public one is from 203.0.113.0/24, a range set aside for examples; the private ones are from 10.0.0.0/8.

/** The load balancer's public IP: what DNS returns for example.com once a load balancer is in front. */
export const LB_PUBLIC_IP = '203.0.113.10';

/** Private IPs of the first two web servers behind the load balancer. */
export const WEB_PRIVATE_IPS = ['10.0.0.11', '10.0.0.12'];
