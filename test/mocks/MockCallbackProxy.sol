// SPDX-License-Identifier: MIT
pragma solidity ^0.8.29;

import { IPayable } from "@reactive/src/interfaces/IPayable.sol";

/// @dev Stand-in for the callback proxy: overwrites the first payload argument with the sender address, then calls the recipient.
contract MockCallbackProxy is IPayable {
    mapping(address => uint256) public debt;

    receive() external payable { }

    function setDebt(address account, uint256 amount) external {
        debt[account] = amount;
    }

    function deliver(address recipient, address reactiveSender, bytes memory payload) external {
        assembly {
            mstore(add(payload, 36), reactiveSender)
        }
        (bool success, bytes memory returndata) = recipient.call(payload);
        if (!success) {
            assembly {
                revert(add(returndata, 32), mload(returndata))
            }
        }
    }
}
