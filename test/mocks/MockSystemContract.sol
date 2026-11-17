// SPDX-License-Identifier: MIT
pragma solidity ^0.8.29;

import { ISystemContract } from "@reactive/src/interfaces/ISystemContract.sol";

/// @dev Stand-in for the Lasna system contract in local tests: records subscriptions and callback requests.
contract MockSystemContract is ISystemContract {
    struct Subscription {
        address subscriber;
        uint256 chainId;
        address source;
        uint256 topic0;
    }

    Subscription[] public subscriptions;
    CallbackConfiguration_V_1_0[] private _callbacks;
    address[] public callbackSenders;
    mapping(address => uint256) public debt;

    receive() external payable { }

    function setDebt(address account, uint256 amount) external {
        debt[account] = amount;
    }

    function subscribe(uint256 chainId_, address contract_, uint256 topic0_, uint256, uint256, uint256) external {
        subscriptions.push(Subscription(msg.sender, chainId_, contract_, topic0_));
    }

    function unsubscribe(uint256, address, uint256, uint256, uint256, uint256) external { }

    function requestCallback(CallbackVersion, bytes memory config_) external {
        _push(abi.decode(config_, (CallbackConfiguration_V_1_0)));
    }

    function requestCallbackV_1_0(CallbackConfiguration_V_1_0 memory config_) external {
        _push(config_);
    }

    function subscriptionCount() external view returns (uint256) {
        return subscriptions.length;
    }

    function callbackCount() external view returns (uint256) {
        return _callbacks.length;
    }

    function callbackAt(uint256 index) external view returns (CallbackConfiguration_V_1_0 memory) {
        return _callbacks[index];
    }

    function _push(CallbackConfiguration_V_1_0 memory config_) private {
        _callbacks.push(config_);
        callbackSenders.push(msg.sender);
    }
}
